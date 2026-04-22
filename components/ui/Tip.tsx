"use client";

import { useState, type ReactNode } from "react";

/**
 * Small inline "did-you-know" tip card — a lightweight surface that
 * teaches a UI feature or best practice at the moment it's most
 * relevant (e.g., an empty state, right after a first save, next to a
 * new control the user may not have discovered).
 *
 * Each tip is keyed by a unique `id`. Once the user taps the dismiss
 * affordance, the id is written to localStorage and the tip never
 * renders for that device/profile again — tips are "teach once", not
 * persistent nags. Because the flag lives in localStorage we can
 * safely default to "not dismissed" during SSR; the client then
 * hydrates and hides the tip instantly if it has been seen before.
 */
const STORAGE_PREFIX = "unfold:tip:";

function tipKey(id: string): string {
  return STORAGE_PREFIX + id;
}

export interface TipProps {
  /** Stable identifier for this tip — used as the localStorage key so
   *  dismissal persists across sessions. Pick descriptive ids
   *  (e.g. "ideas-swipe-delete", "script-generate-from-concept"). */
  id: string;
  /** The tip body. Typically a short sentence. */
  children: ReactNode;
}

export function Tip({ id, children }: TipProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(tipKey(id)) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const onDismiss = () => {
    try {
      localStorage.setItem(tipKey(id), "1");
    } catch {
      /* storage disabled — the tip simply stays dismissed for this session */
    }
    setDismissed(true);
  };

  return (
    <div className="tip-card" role="note">
      <div className="tip-card-icon" aria-hidden="true">💡</div>
      <div className="tip-card-text">{children}</div>
      <button
        className="tip-card-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss tip"
        type="button"
      >
        ×
      </button>
    </div>
  );
}
