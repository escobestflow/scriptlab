// App-wide preferences. Persisted to localStorage so choices survive reloads.
// Each pref gets a read-only loader + a writer + a React hook that mirrors
// localStorage while staying SSR-safe.

import { useCallback, useEffect, useState } from "react";

const AUTOSAVE_KEY = "scriptlab:autosave";
const DARKMODE_KEY = "scriptlab:darkmode";
const DRAFT_PICKER_STYLE_KEY = "scriptlab:draftPickerStyle";
const IMAGE_MODEL_KEY = "scriptlab:imageModel";

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

// ── Draft picker style ────────────────────────────────────────────────
// "sheet"  — bottom-sheet that slides up from the bottom of the viewport
//            (default; current treatment since apr 2026)
// "popup"  — older inline dropdown menu that pops beneath the trigger
//            (restored behind this preference for users who prefer the
//            faster, less-modal popup UX)

export type DraftPickerStyle = "sheet" | "popup";

/** Read the draft-picker style pref. SSR-safe — returns "sheet" default. */
export function loadDraftPickerStyle(): DraftPickerStyle {
  if (typeof window === "undefined") return "sheet";
  try {
    const raw = window.localStorage.getItem(DRAFT_PICKER_STYLE_KEY);
    return raw === "popup" ? "popup" : "sheet";
  } catch {
    return "sheet";
  }
}

/** Persist the draft-picker style pref. No-op on the server. */
export function saveDraftPickerStyle(v: DraftPickerStyle): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_PICKER_STYLE_KEY, v);
  } catch {
    /* localStorage may be disabled — fail silently */
  }
}

// Custom-event channel used to sync every live instance of
// `useDraftPickerStylePref` whenever any one of them writes. Without
// this, Setting's local React state is decoupled from Studio's and
// from every LayerDraftPicker's — they all re-mount their own state
// on mount, and a write in one instance never reaches the others.
// A simple dispatch + listener gets them all back in lock-step.
//
// This shows up sharply for this pref specifically because the WRITER
// (the toggle UI) and the READERS (the popup/sheet consumers) live in
// different subtrees. Autosave + dark-mode prefs don't need this
// because they're read/written from a single place (app/page.tsx) and
// threaded down as props.
const DRAFT_PICKER_STYLE_EVENT = "scriptlab:draftPickerStyle";

/**
 * React hook backing the draft-picker style pref. Consumers can switch
 * between the modern bottom-sheet treatment ("sheet") and the legacy
 * inline popup ("popup") for both the project-drafts dropdown and all
 * layer-draft dropdowns. SSR-renders "sheet", reconciles with
 * localStorage on mount, and subscribes to a cross-instance custom
 * event so every hook instance stays in sync when any one of them
 * writes (see DRAFT_PICKER_STYLE_EVENT above for why).
 */
export function useDraftPickerStylePref(): [
  DraftPickerStyle,
  (v: DraftPickerStyle) => void,
] {
  const [value, setValue] = useState<DraftPickerStyle>("sheet");

  // Hydrate + subscribe in one effect so teardown unsubscribes cleanly.
  useEffect(() => {
    setValue(loadDraftPickerStyle());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<DraftPickerStyle>).detail;
      if (detail === "sheet" || detail === "popup") {
        setValue(detail);
      }
    };
    // Also listen on the native `storage` event so a change in one
    // tab propagates to other tabs that also have the app open.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DRAFT_PICKER_STYLE_KEY) return;
      setValue(loadDraftPickerStyle());
    };
    window.addEventListener(DRAFT_PICKER_STYLE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DRAFT_PICKER_STYLE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((next: DraftPickerStyle) => {
    setValue(next);
    saveDraftPickerStyle(next);
    // Broadcast so sibling hook instances sync their state.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(DRAFT_PICKER_STYLE_EVENT, { detail: next }),
      );
    }
  }, []);

  return [value, set];
}

// ── Image generation model ──────────────────────────────────────────
// Controls which OpenAI image model is used for AUTO-generation
// (character portraits, scene/episode thumbnails). Users can override
// per-image via the explicit "Regenerate (Premium)" button in each
// edit popup; this pref governs the default that fires unattended.
//
// "dall-e-3"     — cheaper, faster, default. ~$0.04 per standard image.
// "gpt-image-2"  — premium, higher quality. ~5× the cost.
//
// Project-cover generation always uses gpt-image-2 (covers are
// infrequent and the quality bump is worth it) — see /api/generate-
// thumbnail/route.ts for the V2 routing logic that's untouched by
// this pref.

export type ImageModelPref = "dall-e-3" | "gpt-image-2";

/** Read the image-model pref. SSR-safe — returns "dall-e-3" default. */
export function loadImageModelPref(): ImageModelPref {
  if (typeof window === "undefined") return "dall-e-3";
  try {
    const raw = window.localStorage.getItem(IMAGE_MODEL_KEY);
    return raw === "gpt-image-2" ? "gpt-image-2" : "dall-e-3";
  } catch {
    return "dall-e-3";
  }
}

/** Persist the image-model pref. No-op on the server. */
export function saveImageModelPref(v: ImageModelPref): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IMAGE_MODEL_KEY, v);
  } catch {
    /* localStorage may be disabled — fail silently */
  }
}

/**
 * React hook backing the image-model pref. SSR-renders the cheap
 * default and reconciles with localStorage after mount. Same shape
 * as `useAutosavePref`. Consumers: the settings toggle, plus every
 * auto-generation client path (character, scene, episode) reads
 * this and forwards it as the `model` param in their POST body.
 */
export function useImageModelPref(): [ImageModelPref, (v: ImageModelPref) => void] {
  const [value, setValue] = useState<ImageModelPref>("dall-e-3");

  useEffect(() => {
    setValue(loadImageModelPref());
  }, []);

  const set = useCallback((next: ImageModelPref) => {
    setValue(next);
    saveImageModelPref(next);
  }, []);

  return [value, set];
}
