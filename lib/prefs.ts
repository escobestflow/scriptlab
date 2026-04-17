// App-wide preferences. Persisted to localStorage so choices survive reloads.
// Single pref today (autosave), but structured so more can be added.

import { useCallback, useEffect, useState } from "react";

const AUTOSAVE_KEY = "scriptlab:autosave";

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
