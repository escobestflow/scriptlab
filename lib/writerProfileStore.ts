"use client";

// Writer-profile persistence + React hook.
//
// Storage strategy (fast reads, resilient writes):
//   - In-memory React state holds the profile for immediate re-renders.
//   - localStorage mirrors the profile under `ws:writer-profile:<uid>`
//     so a refresh has a first-paint value before Supabase responds.
//   - Supabase is the source of truth across devices — upserts are
//     debounced 3s so chip-clicking doesn't hammer the network.
//
// Anonymous users (no user.id) still get a working profile locally under
// key `ws:writer-profile:anon`. It migrates to their user row after login
// the first time they call any capture function with a real user.id.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import {
  WriterProfile,
  ProfileCategory,
  ProfileExemplar,
  emptyProfile,
  recordSignal as pureRecordSignal,
  recordSignals as pureRecordSignals,
  recordStyleSample as pureRecordStyleSample,
  PROFILE_SCHEMA_VERSION,
} from "./writerProfile";

const LOCAL_KEY_PREFIX = "ws:writer-profile:";
const DEBOUNCE_MS = 3000;

function localKey(userId: string | null | undefined): string {
  return LOCAL_KEY_PREFIX + (userId || "anon");
}

function readLocal(userId: string | null | undefined): WriterProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WriterProfile;
    if (!parsed || typeof parsed !== "object" || !parsed.preferences) return null;
    // Future-proofing: if the schema bumps, drop incompatible blobs.
    if (parsed.schemaVersion !== PROFILE_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocal(userId: string | null | undefined, profile: WriterProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(profile));
  } catch {
    // Quota exceeded or private mode — ignore; Supabase still has the real copy.
  }
}

export async function loadWriterProfileFromDB(userId: string): Promise<WriterProfile | null> {
  const { data, error } = await supabase
    .from("writer_profiles")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const profile = data.data as WriterProfile;
  if (!profile || profile.schemaVersion !== PROFILE_SCHEMA_VERSION) return null;
  return profile;
}

export async function saveWriterProfileToDB(userId: string, profile: WriterProfile): Promise<void> {
  const { error } = await supabase
    .from("writer_profiles")
    .upsert({
      user_id: userId,
      data: profile,
      updated_at: new Date().toISOString(),
    });
  if (error) console.error("[writer-profile] save error:", error);
}

// ─── React hook ───────────────────────────────────────────────────────

export interface WriterProfileAPI {
  profile: WriterProfile;
  /** Record one chip/selection event. Safe to call on every toggle. */
  capture: (category: ProfileCategory, value: string) => void;
  /** Batch-capture an array of values into one category. */
  captureMany: (category: ProfileCategory, values: string[]) => void;
  /** Record a prose sample (updates voice metrics + exemplar pool). */
  captureStyle: (text: string, kind: ProfileExemplar["kind"]) => void;
  /** True once the first load attempt (local + remote) has finished. */
  loaded: boolean;
}

export function useWriterProfile(userId: string | null | undefined): WriterProfileAPI {
  // Initialise from localStorage synchronously so the first render already
  // has signal — we only fall back to an empty profile if no local copy
  // exists for this user id.
  const [profile, setProfile] = useState<WriterProfile>(() => readLocal(userId) ?? emptyProfile());
  const [loaded, setLoaded] = useState<boolean>(false);

  // Keep a live ref so debounced writes always see the latest profile.
  const latest = useRef(profile);
  useEffect(() => { latest.current = profile; }, [profile]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback((uid: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveWriterProfileToDB(uid, latest.current);
    }, DEBOUNCE_MS);
  }, []);

  // Flush any pending save when the window is about to unload — prevents
  // losing the last few signals if the user closes the tab quickly.
  useEffect(() => {
    if (!userId) return;
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void saveWriterProfileToDB(userId, latest.current);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [userId]);

  // When the user identity becomes known, load from Supabase and reconcile.
  // Reconciliation rule: pick whichever profile has the higher totalEvents
  // (more captured signal = more authoritative). If the local anon profile
  // has more events than the remote, push it up.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userId) {
        setLoaded(true);
        return;
      }
      const [remote, local] = [await loadWriterProfileFromDB(userId), readLocal(userId) ?? readLocal(null)];
      if (cancelled) return;
      let winner: WriterProfile;
      if (remote && local) {
        winner = local.totalEvents > remote.totalEvents ? local : remote;
      } else if (remote) {
        winner = remote;
      } else if (local) {
        winner = local;
      } else {
        winner = emptyProfile();
      }
      setProfile(winner);
      writeLocal(userId, winner);
      // If we promoted a local anon profile, push it to the DB now.
      if (winner === local && !remote) {
        void saveWriterProfileToDB(userId, winner);
      }
      setLoaded(true);
    }
    void load();
    return () => { cancelled = true; };
  }, [userId]);

  // Persist on every change: localStorage sync, Supabase debounced.
  const commit = useCallback((next: WriterProfile) => {
    setProfile(next);
    writeLocal(userId, next);
    if (userId) scheduleSave(userId);
  }, [userId, scheduleSave]);

  const capture = useCallback((category: ProfileCategory, value: string) => {
    commit(pureRecordSignal(latest.current, category, value));
  }, [commit]);

  const captureMany = useCallback((category: ProfileCategory, values: string[]) => {
    commit(pureRecordSignals(latest.current, category, values));
  }, [commit]);

  const captureStyle = useCallback((text: string, kind: ProfileExemplar["kind"]) => {
    commit(pureRecordStyleSample(latest.current, text, kind));
  }, [commit]);

  return { profile, capture, captureMany, captureStyle, loaded };
}

// ─── Context plumbing ────────────────────────────────────────────────
// A context lets any descendant component capture signals without prop
// drilling. When a component isn't wrapped in the provider (e.g. in a
// test or an early boot render) the hook returns a safe no-op API.

export const WriterProfileContext = createContext<WriterProfileAPI | null>(null);

const NOOP_API: WriterProfileAPI = {
  profile: emptyProfile(),
  capture: () => {},
  captureMany: () => {},
  captureStyle: () => {},
  loaded: false,
};

/** Consume the shared profile API. Falls back to no-ops outside the provider. */
export function useProfileCapture(): WriterProfileAPI {
  return useContext(WriterProfileContext) ?? NOOP_API;
}

