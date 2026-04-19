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
    // Surface both status and server body so failures are actually debuggable.
    throw new Error(`/api/tts ${res.status}: ${err || "(no body)"}`);
  }
  const buf = await res.arrayBuffer();
  putCached(key, buf).catch(() => {});
  return buf;
}

// ── Playback controller ────────────────────────────────────────────
//
// Uses plain HTMLAudioElement, which plays reliably across every browser
// we care about. We tried Web Audio for gapless chunk stitching, but the
// autoplay-gesture rules are brittle and led to silent failures — trading
// a small inter-chunk gap for actually-playing audio is the right call.

type Listener = (activeOwner: symbol | null) => void;

// Tiny silent WAV (8kHz mono, 4 sample frames) used to unlock the
// HTMLAudioElement on iOS/Safari during the click gesture. Any valid
// audio file works — we just need .play() to succeed once while the
// user's tap is still "live," after which the element is free to play
// subsequent sources without a fresh gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQgAAAAAAAAAAAAAAA==";

class PlaybackController {
  // One persistent HTMLAudioElement, reused across every chunk of every
  // playback. iOS Safari gates *element* unlocking, not *controller* —
  // so we unlock this single element once (via prime(), below) and then
  // keep reassigning .src to new blob URLs for each chunk.
  private audio: HTMLAudioElement | null = null;
  // Last blob URL so we can revoke it when we move on to the next chunk
  // or stop. Stored separately from `audio.src` because after stop() we
  // still want to keep the element alive and unlocked.
  private currentBlobUrl: string | null = null;
  private primed = false;
  private activeOwner: symbol | null = null;
  private listeners = new Set<Listener>();
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

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = "auto";
    this.audio = a;
    return a;
  }

  /**
   * Called synchronously from the click handler. Unlocks the shared
   * HTMLAudioElement on iOS/Safari by playing a tiny silent WAV while
   * the user gesture is still active. After this, subsequent
   * reassignments of .src followed by .play() work without a new gesture
   * — fixing the "NotAllowedError: request is not allowed by the user
   * agent" that fires when audio fetches take longer than the gesture
   * window.
   */
  prime(): void {
    const a = this.ensureAudio();
    if (this.primed) return;
    try {
      a.muted = true;
      a.src = SILENT_WAV;
      const p = a.play();
      const finish = () => {
        try { a.pause(); } catch { /* noop */ }
        a.muted = false;
        a.removeAttribute("src");
        a.load();
      };
      if (p && typeof (p as any).then === "function") {
        (p as Promise<void>).then(finish).catch(() => { a.muted = false; });
      } else {
        finish();
      }
      this.primed = true;
    } catch {
      // Priming failed (rare — e.g. bad data URL). Fall through; the
      // subsequent .play() may still succeed on non-mobile browsers.
      a.muted = false;
    }
  }

  stop(): void {
    this.epoch++;
    if (this.audio) {
      try {
        this.audio.pause();
      } catch {
        /* noop */
      }
      // Keep the element alive so the unlock survives across plays.
      // Just clear the src so the old blob isn't held.
      try { this.audio.removeAttribute("src"); this.audio.load(); } catch { /* noop */ }
    }
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
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

    // Fire every producer in parallel; play back in sequence order.
    // Track the first error so we can surface a real message to the user
    // if every chunk fails — a generic "nothing played" is useless for
    // debugging.
    let firstError: unknown = null;
    const pending = producers.map(p =>
      p().catch(e => {
        console.error("[tts] chunk failed", e);
        if (!firstError) firstError = e;
        return null;
      }),
    );

    let played = 0;
    for (let i = 0; i < pending.length; i++) {
      if (myEpoch !== this.epoch || this.activeOwner !== owner) return;
      const buf = await pending[i];
      if (myEpoch !== this.epoch) return;
      if (!buf) continue;
      try {
        await this.playOne(buf, myEpoch);
        played++;
      } catch (e) {
        console.error("[tts] playOne failed", e);
        if (!firstError) firstError = e;
      }
    }

    if (myEpoch === this.epoch && this.activeOwner === owner) {
      this.activeOwner = null;
      this.emit();
    }

    if (played === 0) {
      const detail =
        firstError instanceof Error ? firstError.message :
        firstError ? String(firstError) :
        "no chunks produced audio";
      throw new Error(`TTS playback failed — ${detail}`);
    }
  }

  private playOne(buf: ArrayBuffer, myEpoch: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (myEpoch !== this.epoch) {
        resolve();
        return;
      }
      const a = this.ensureAudio();

      // Revoke the previous chunk's blob before we overwrite src.
      if (this.currentBlobUrl) {
        URL.revokeObjectURL(this.currentBlobUrl);
        this.currentBlobUrl = null;
      }

      const blob = new Blob([buf], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      this.currentBlobUrl = url;

      const onEnded = () => {
        a.removeEventListener("ended", onEnded);
        a.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        a.removeEventListener("ended", onEnded);
        a.removeEventListener("error", onError);
        reject(new Error("audio element error"));
      };
      a.addEventListener("ended", onEnded);
      a.addEventListener("error", onError);

      a.src = url;
      a.play().catch(err => {
        a.removeEventListener("ended", onEnded);
        a.removeEventListener("error", onError);
        reject(err);
      });
    });
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
