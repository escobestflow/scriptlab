// App-wide preferences. Persisted to localStorage so choices survive reloads.
// Each pref gets a read-only loader + a writer + a React hook that mirrors
// localStorage while staying SSR-safe.

import { useCallback, useEffect, useState } from "react";

const AUTOSAVE_KEY = "scriptlab:autosave";
const DARKMODE_KEY = "scriptlab:darkmode";

/** Read the autosave pref. SSR-safe — returns the default (true) on the server. */
export function loadAutosave(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

/** Persist the autosave pref. No-op on the server. */
export function saveAutosave(v: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTOSAVE_KEY, v ? "1" : "0");
  } catch {
    /* localStorage may be disabled — fail silently */
  }
}

/**
 * React hook backing the autosave pref.
 * SSR-renders `true` (the default) and reconciles with localStorage after mount.
 */
export function useAutosavePref(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(true);

  // Hydrate from localStorage once on the client.
  useEffect(() => {
    setValue(loadAutosave());
  }, []);

  const set = useCallback((next: boolean) => {
    setValue(next);
    saveAutosave(next);
  }, []);

  return [value, set];
}

// ── Dark mode ─────────────────────────────────────────────────────────
// Default is light (false). When true, <html data-theme="dark"> is set and
// globals.css flips the color variables. Also written to localStorage under
// the same `scriptlab:*` key convention.

/** Read the dark-mode pref. SSR-safe — returns the default (false). */
export function loadDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DARKMODE_KEY);
    return raw === "1";
  } catch {
    return false;
  }
}

/** Persist the dark-mode pref. No-op on the server. */
export function saveDarkMode(v: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DARKMODE_KEY, v ? "1" : "0");
  } catch {
    /* localStorage may be disabled — fail silently */
  }
}

/**
 * React hook backing the dark-mode pref. Mirrors the value into
 * <html data-theme="…"> on every change so CSS overrides can react.
 * SSR-renders `false` and reconciles with localStorage after mount —
 * pair with the pre-hydration script in app/layout.tsx to avoid FOUC.
 */
export function useDarkModePref(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(false);

  // Hydrate from localStorage once on the client.
  useEffect(() => {
    setValue(loadDarkMode());
  }, []);

  // Mirror into document root so CSS [data-theme="dark"] rules engage.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = value ? "dark" : "light";
  }, [value]);

  const set = useCallback((next: boolean) => {
    setValue(next);
    saveDarkMode(next);
  }, []);

  return [value, set];
}
