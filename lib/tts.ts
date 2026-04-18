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
import { getNarratorStyle, getStyleForProject } from "./ttsStyle";

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
): Promise<string> {
  const enc = new TextEncoder().encode(`${voice}\n${instructions}\n${text}`);
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
): Promise<ArrayBuffer> {
  const key = await cacheKey(text, voice, instructions);
  const cached = await getCached(key);
  if (cached) return cached;

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, instructions }),
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

type Listener = (activeOwner: symbol | null) => void;

class PlaybackController {
  private audio: HTMLAudioElement | null = null;
  private activeOwner: symbol | null = null;
  private listeners = new Set<Listener>();

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

  stop(): void {
    if (this.audio) {
      try {
        this.audio.pause();
      } catch {
        /* noop */
      }
      if (this.audio.src.startsWith("blob:")) URL.revokeObjectURL(this.audio.src);
      this.audio = null;
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
    this.emit();

    // Fire every producer in parallel; the browser + server will handle
    // concurrency. We play them back in sequence order.
    const pending = producers.map(p =>
      p().catch(e => {
        console.error("tts chunk failed", e);
        return null;
      }),
    );

    for (let i = 0; i < pending.length; i++) {
      if (this.activeOwner !== owner) return;
      const buf = await pending[i];
      if (this.activeOwner !== owner) return;
      if (!buf) continue;
      await this.playOne(buf);
    }

    if (this.activeOwner === owner) {
      this.activeOwner = null;
      this.emit();
    }
  }

  private playOne(buf: ArrayBuffer): Promise<void> {
    return new Promise(resolve => {
      const blob = new Blob([buf], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      this.audio = a;
      const done = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      a.onended = done;
      a.onerror = done;
      a.play().catch(done);
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
}

export async function speak(
  text: string,
  owner: symbol,
  opts: SpeakOpts = {},
): Promise<void> {
  const voice = opts.voice ?? "onyx";
  const instructions =
    opts.instructions ?? getStyleForProject(opts.projectType, opts.genres);
  await playback.play(owner, [() => fetchAudio(text, voice, instructions)]);
}

export async function speakScript(
  scriptText: string,
  characters: Character[],
  owner: symbol,
  opts: SpeakOpts = {},
): Promise<void> {
  const chunks = parseScreenplay(scriptText);
  if (!chunks.length) return;

  const narratorStyle = getNarratorStyle(opts.projectType, opts.genres);
  const charStyle = getStyleForProject(opts.projectType, opts.genres);

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
        return fetchAudio(c.text, "onyx", narratorStyle);
      }
      return fetchAudio(c.text, voiceFor(c.character || ""), charStyle);
    });

  await playback.play(owner, producers);
}

export function stopSpeaking(): void {
  playback.stop();
}
