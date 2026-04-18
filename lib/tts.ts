// Client-side TTS orchestration.
//
//   - `speak(text, owner, opts)` plays a single string in one voice.
//   - `speakScript(text, characters, owner, opts)` parses screenplay text
//     into chunks, assigns per-character voices, and plays in order with
//     the narrator reading action/scene-heading lines.
//
// MP3 bytes are cached in IndexedDB keyed on a SHA-256 of
// (voice + instructions + text), so re-playing identical content is free.
//
// A single global PlaybackController enforces "only one thing plays at once."
// Each caller passes an `owner: symbol` — when another caller takes over,
// the previous owner is notified and stops.

import {
  parseScreenplay,
  assignCharacterVoice,
  type TtsVoice,
} from "./scriptParse";
import type { Character, Genre, ProjectType } from "./story";
import { DEFAULT_TTS_SPEED, getNarratorStyle, getStyleForProject } from "./ttsStyle";
import { expandScreenwritingAbbreviations } from "./ttsExpand";

// ── IndexedDB cache ─────────────────────────────────────────────────

const DB_NAME = "scriptlab-tts";
const STORE = "audio";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function cacheKey(
  text: string,
  voice: string,
  instructions: string,
  speed: number,
): Promise<string> {
  const enc = new TextEncoder().encode(
    `${voice}\n${instructions}\n${speed}\n${text}`,
  );
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getCached(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () =>
        resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function putCached(key: string, buf: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(buf, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* cache miss is fine */
  }
}

async function fetchAudio(
  text: string,
  voice: string,
  instructions: string,
  speed: number,
): Promise<ArrayBuffer> {
  // Spell out screenwriting abbreviations (INT. → "Interior", V.O. →
  // "voice over", etc.) before both hashing and sending, so cache hits
  // reflect what actually gets sent to the model.
  const expanded = expandScreenwritingAbbreviations(text);

  const key = await cacheKey(expanded, voice, instructions, speed);
  const cached = await getCached(key);
  if (cached) return cached;

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: expanded, voice, instructions, speed }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `TTS failed (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  putCached(key, buf).catch(() => {});
  return buf;
}

// ── Playback controller ────────────────────────────────────────────
//
// Web Audio API rather than <audio> elements: lets us schedule each chunk
// to start precisely at the previous chunk's tail (with a tiny overlap to
// absorb the TTS model's trailing silence), so scene reads feel gapless.

type Listener = (activeOwner: symbol | null) => void;

// Overlap between chunks, in seconds. Absorbs ~40–60 ms of trailing silence
// the TTS model tends to append to each clip. Tuning higher = tighter reads
// but risks clipping the last phoneme of long chunks.
const CHUNK_OVERLAP_S = 0.06;

class PlaybackController {
  private ctx: AudioContext | null = null;
  private activeOwner: symbol | null = null;
  private listeners = new Set<Listener>();
  private sources: AudioBufferSourceNode[] = [];
  private gain: GainNode | null = null;
  // Bumped every stop() so in-flight schedulers bail.
  private epoch = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getActiveOwner(): symbol | null {
    return this.activeOwner;
  }

  private emit() {
    for (const l of this.listeners) l(this.activeOwner);
  }

  private getCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctor();
    }
    return this.ctx!;
  }

  /**
   * Call this SYNCHRONOUSLY from the click handler that initiates playback.
   * Most browsers (especially Safari/iOS) only allow a fresh AudioContext
   * to be created — or a suspended one to be resumed — during the user
   * gesture itself. If we wait for the first `await` in play(), the
   * gesture has expired and nothing will produce audio.
   */
  prime(): void {
    if (typeof window === "undefined") return;
    try {
      const ctx = this.getCtx();
      if (ctx.state === "suspended") {
        // Fire-and-forget; the context is now latched to this gesture.
        ctx.resume().catch(() => {});
      }
    } catch {
      /* browser lacks Web Audio — callers will see a thrown error later */
    }
  }

  stop(): void {
    this.epoch++;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      try {
        s.disconnect();
      } catch {
        /* noop */
      }
    }
    this.sources = [];
    if (this.gain) {
      try {
        this.gain.disconnect();
      } catch {
        /* noop */
      }
      this.gain = null;
    }
    if (this.activeOwner !== null) {
      this.activeOwner = null;
      this.emit();
    }
  }

  async play(
    owner: symbol,
    producers: (() => Promise<ArrayBuffer>)[],
  ): Promise<void> {
    this.stop();
    if (!producers.length) return;
    this.activeOwner = owner;
    const myEpoch = this.epoch;
    this.emit();

    const ctx = this.getCtx();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* browser autoplay policy; will error below on start() */
      }
    }

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    this.gain = gain;

    // Fire every producer in parallel; play back in sequence order.
    const pending = producers.map(p =>
      p().catch(e => {
        console.error("[tts] chunk failed", e);
        return null;
      }),
    );

    let nextStart = ctx.currentTime + 0.04;
    const finished: Promise<void>[] = [];
    let scheduled = 0;

    for (let i = 0; i < pending.length; i++) {
      if (myEpoch !== this.epoch || this.activeOwner !== owner) return;
      const buf = await pending[i];
      if (myEpoch !== this.epoch) return;
      if (!buf) continue;

      let audioBuf: AudioBuffer;
      try {
        // decodeAudioData detaches the buffer — give it a copy so the
        // original ArrayBuffer stays cacheable.
        audioBuf = await ctx.decodeAudioData(buf.slice(0));
      } catch (e) {
        console.error("[tts] decode failed", e);
        continue;
      }
      if (myEpoch !== this.epoch) return;

      // If chunks arrive slower than the playhead advances, clamp start
      // forward so we don't schedule in the past.
      const earliest = ctx.currentTime + 0.02;
      const startAt = Math.max(earliest, nextStart - CHUNK_OVERLAP_S);

      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(gain);
      src.start(startAt);
      this.sources.push(src);
      scheduled++;

      nextStart = startAt + audioBuf.duration;

      finished.push(
        new Promise<void>(resolve => {
          src.onended = () => resolve();
        }),
      );
    }

    await Promise.all(finished);
    if (myEpoch === this.epoch && this.activeOwner === owner) {
      this.activeOwner = null;
      this.emit();
    }

    // If nothing ever played, surface the error so callers (and the UI)
    // know to show a failure state instead of silently succeeding.
    if (scheduled === 0) {
      throw new Error(
        "No audio chunks could be played. Check /api/tts responses in the Network tab.",
      );
    }
  }
}

export const playback = new PlaybackController();

// ── Public API ─────────────────────────────────────────────────────

export interface SpeakOpts {
  projectType?: ProjectType;
  genres?: Genre[];
  voice?: TtsVoice;
  /** Override style instruction (normally inferred from project + genre). */
  instructions?: string;
  /** Playback speed 0.25–4.0. Defaults to DEFAULT_TTS_SPEED. */
  speed?: number;
}

export async function speak(
  text: string,
  owner: symbol,
  opts: SpeakOpts = {},
): Promise<void> {
  const voice = opts.voice ?? "onyx";
  const instructions =
    opts.instructions ?? getStyleForProject(opts.projectType, opts.genres);
  const speed = opts.speed ?? DEFAULT_TTS_SPEED;
  await playback.play(owner, [
    () => fetchAudio(text, voice, instructions, speed),
  ]);
}

export async function speakScript(
  scriptText: string,
  characters: Character[],
  owner: symbol,
  opts: SpeakOpts = {},
): Promise<void> {
  const chunks = parseScreenplay(scriptText);
  if (!chunks.length) return;

  // Diagnostic: log how the parser broke the scene apart. If multi-voice
  // isn't engaging, the breakdown here tells us whether dialogue was
  // detected at all and which characters / voices were assigned.
  if (typeof console !== "undefined") {
    const dialogue = chunks.filter(c => c.kind === "dialogue");
    const speakers = Array.from(new Set(dialogue.map(d => d.character || "?")));
    console.log("[tts] parsed", {
      total: chunks.length,
      dialogue: dialogue.length,
      action: chunks.filter(c => c.kind === "action").length,
      headings: chunks.filter(c => c.kind === "heading").length,
      speakers,
    });
  }

  const narratorStyle = getNarratorStyle(opts.projectType, opts.genres);
  const charStyle = getStyleForProject(opts.projectType, opts.genres);
  const speed = opts.speed ?? DEFAULT_TTS_SPEED;

  // Pre-seed voice map from the Characters layer so `voice` hints carry over.
  const voiceMap = new Map<string, TtsVoice>();
  for (const c of characters) {
    if (c.name) {
      voiceMap.set(c.name.toUpperCase(), assignCharacterVoice(c.name, c.voice));
    }
  }
  const voiceFor = (rawName: string): TtsVoice => {
    const key = rawName.toUpperCase();
    const existing = voiceMap.get(key);
    if (existing) return existing;
    const v = assignCharacterVoice(rawName);
    voiceMap.set(key, v);
    return v;
  };

  const producers = chunks
    // Parentheticals are acting notes, not spoken — skip them.
    .filter(c => c.kind !== "parenthetical")
    .map(c => () => {
      if (c.kind === "heading" || c.kind === "action") {
        return fetchAudio(c.text, "onyx", narratorStyle, speed);
      }
      return fetchAudio(c.text, voiceFor(c.character || ""), charStyle, speed);
    });

  await playback.play(owner, producers);
}

export function stopSpeaking(): void {
  playback.stop();
}
