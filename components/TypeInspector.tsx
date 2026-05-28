"use client";

// Admin-only design-system inspector. When the user toggles
// "Type Inspector" in Settings, this component attaches a capture-
// phase pointerdown listener on the document. Any click outside the
// inspector's own UI is intercepted:
//
//   1. Walk up the DOM from the clicked node looking for an element
//      with a `ds-type-*` class. That's the "active" token.
//   2. Open a floating panel next to the click that shows:
//        - The current token name (or "no token detected")
//        - The computed font-family / size / weight / line-height /
//          letter-spacing so you can see what's actually rendering
//        - A scrollable list of every ds-type-* token with a sample
//          rendered in that style; clicking one swaps the class on
//          the target element so you can see the change live
//
// Strictly an in-DOM dev tool — nothing persists. A reload puts the
// page back to its original tokens. Mounted at the app root via
// app/page.tsx so the listener covers every surface.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTypeInspectorPref } from "@/lib/prefs";

// Hand-maintained list of every ds-type-* token defined in
// app/globals.css. Keep this in sync when new tokens are added —
// the inspector reads from this list, NOT from the live stylesheet,
// so missing entries here mean missing entries in the picker.
// The order roughly mirrors the type-scale hierarchy (display →
// headers → body → micro) so the picker reads top-down.
const DS_TYPE_TOKENS: string[] = [
  "ds-type-project-page-title",
  "ds-type-project-page-title-empty",
  "ds-type-tab-header",
  "ds-type-empty-header",
  "ds-type-empty",
  "ds-type-int-header",
  "ds-type-int-heading",
  "ds-type-attribute-title",
  "ds-type-project-card-title",
  "ds-type-project-card-pill-label",
  "ds-type-draft-dropdown",
  "ds-type-selected-option-label",
  "ds-type-main-tab-nav-active",
  "ds-type-main-tab-nav-inactive",
  "ds-type-project-tab-nav-active",
  "ds-type-project-tab-nav-inactive",
  "ds-type-cta",
  "ds-type-button-label",
  "ds-type-body-bold",
  "ds-type-body",
  "ds-type-body-sm",
];

const DS_TYPE_TOKEN_SET = new Set(DS_TYPE_TOKENS);

interface InspectionTarget {
  el: HTMLElement;
  /** The ds-type-* class found on `el` or one of its ancestors,
   *  or null if none was found. */
  activeToken: string | null;
  /** Where to anchor the popup. */
  anchor: { left: number; top: number };
}

function findTokenOnElement(el: HTMLElement): string | null {
  if (!el.classList) return null;
  for (const cls of Array.from(el.classList)) {
    if (DS_TYPE_TOKEN_SET.has(cls)) return cls;
  }
  return null;
}

function findActiveToken(start: HTMLElement): { el: HTMLElement; token: string } | null {
  let cur: HTMLElement | null = start;
  while (cur && cur !== document.body) {
    const tok = findTokenOnElement(cur);
    if (tok) return { el: cur, token: tok };
    cur = cur.parentElement;
  }
  return null;
}

export default function TypeInspector() {
  const [enabled] = useTypeInspectorPref();
  const [target, setTarget] = useState<InspectionTarget | null>(null);
  // Track the original token so the user can see what was there
  // before they started swapping — useful for "revert" affordance.
  const [originalToken, setOriginalToken] = useState<string | null>(null);
  // Track the LIVE element we're swapping classes on, even after
  // the user picks alternatives. Differs from `target.el` only when
  // we had to fall back to the clicked element because no token-
  // bearing ancestor existed (in which case `target.el === clicked`).
  const swapTargetRef = useRef<HTMLElement | null>(null);

  // Capture-phase pointerdown handler. preventDefault + stopPropagation
  // so the user can click on actual buttons/links without firing them.
  const onPointerDown = useCallback((e: PointerEvent) => {
    if (!enabled) return;
    const clicked = e.target as HTMLElement | null;
    if (!clicked) return;
    // Ignore clicks inside our own popup so the user can pick options
    // without immediately re-opening on themselves.
    if (clicked.closest("[data-type-inspector-ui]")) return;
    e.preventDefault();
    e.stopPropagation();

    const found = findActiveToken(clicked);
    const swapEl = found?.el ?? clicked;
    const activeToken = found?.token ?? null;
    swapTargetRef.current = swapEl;
    setOriginalToken(activeToken);
    setTarget({
      el: swapEl,
      activeToken,
      anchor: { left: e.clientX, top: e.clientY },
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setTarget(null);
      return;
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [enabled, onPointerDown]);

  // When toggled off mid-inspection, dismiss the popup.
  useEffect(() => {
    if (!enabled) setTarget(null);
  }, [enabled]);

  if (!enabled || !target) return null;

  // Apply a token: remove all DS_TYPE_TOKEN_SET classes from the
  // element, then add the requested one. We swap in-place rather
  // than wrapping a new element so adjacent siblings stay intact.
  const applyToken = (next: string | null) => {
    const el = swapTargetRef.current;
    if (!el) return;
    for (const t of DS_TYPE_TOKENS) el.classList.remove(t);
    if (next) el.classList.add(next);
    setTarget(t => (t ? { ...t, activeToken: next } : t));
  };

  return <InspectorPanel target={target} originalToken={originalToken} applyToken={applyToken} onClose={() => setTarget(null)} />;
}

function InspectorPanel({
  target, originalToken, applyToken, onClose,
}: {
  target: InspectionTarget;
  originalToken: string | null;
  applyToken: (next: string | null) => void;
  onClose: () => void;
}) {
  // Compute the actual rendered properties so the user can see what
  // the token resolved to in this viewport. Recompute when the
  // active token changes so the readout reflects the swap.
  const [readout, setReadout] = useState<{
    fontFamily: string; fontSize: string; fontWeight: string;
    lineHeight: string; letterSpacing: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cs = window.getComputedStyle(target.el);
    setReadout({
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
    });
  }, [target.el, target.activeToken]);

  // Position the panel near the click but keep it inside the
  // viewport. 360px wide; if there's no room to the right of the
  // click, anchor to the left of it instead.
  const panelWidth = 360;
  const panelMargin = 12;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  let left = target.anchor.left + 16;
  if (left + panelWidth + panelMargin > vw) {
    left = Math.max(panelMargin, target.anchor.left - panelWidth - 16);
  }
  let top = target.anchor.top + 16;
  // Don't run off the bottom of the viewport.
  const estimatedMaxHeight = Math.min(560, vh - 2 * panelMargin);
  if (top + estimatedMaxHeight > vh) {
    top = Math.max(panelMargin, vh - estimatedMaxHeight - panelMargin);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-type-inspector-ui="panel"
      style={{
        position: "fixed",
        left,
        top,
        width: panelWidth,
        maxHeight: estimatedMaxHeight,
        background: "#1f1f1f",
        color: "#f4f4f4",
        borderRadius: 12,
        boxShadow: "0 10px 32px rgba(0,0,0,0.4)",
        zIndex: 100000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid #333",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div>
          <div style={{ opacity: 0.6, fontSize: 10, letterSpacing: 0.08, textTransform: "uppercase" }}>
            Active token
          </div>
          <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, marginTop: 2 }}>
            {target.activeToken ?? <span style={{ opacity: 0.6 }}>(no ds-type-* class)</span>}
          </div>
          <div style={{ opacity: 0.6, fontSize: 10, marginTop: 6 }}>
            Tag: &lt;{target.el.tagName.toLowerCase()}&gt;
            {target.el.classList.length > 0 && (
              <span> · {target.el.classList.length} class{target.el.classList.length === 1 ? "" : "es"}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#f4f4f4",
            fontSize: 18,
            lineHeight: 1,
            cursor: "pointer",
            padding: 4,
            flexShrink: 0,
          }}
          aria-label="Close inspector"
          data-type-inspector-ui="close"
        >
          ×
        </button>
      </div>
      {readout && (
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid #333",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            opacity: 0.85,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "2px 12px",
          }}
        >
          <span style={{ opacity: 0.5 }}>font-family</span><span>{readout.fontFamily}</span>
          <span style={{ opacity: 0.5 }}>font-size</span><span>{readout.fontSize}</span>
          <span style={{ opacity: 0.5 }}>font-weight</span><span>{readout.fontWeight}</span>
          <span style={{ opacity: 0.5 }}>line-height</span><span>{readout.lineHeight}</span>
          <span style={{ opacity: 0.5 }}>letter-spacing</span><span>{readout.letterSpacing}</span>
        </div>
      )}
      {originalToken && originalToken !== target.activeToken && (
        <div
          style={{
            padding: "6px 14px",
            borderBottom: "1px solid #333",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            background: "rgba(255, 200, 100, 0.08)",
          }}
        >
          <span style={{ opacity: 0.85 }}>
            Modified — original was <code style={{ background: "#000", padding: "1px 4px", borderRadius: 3 }}>{originalToken}</code>
          </span>
          <button
            type="button"
            onClick={() => applyToken(originalToken)}
            style={{
              background: "#444",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "3px 8px",
              fontSize: 11,
              cursor: "pointer",
            }}
            data-type-inspector-ui="revert"
          >
            Revert
          </button>
        </div>
      )}
      <div
        style={{ overflowY: "auto", flex: 1 }}
        data-type-inspector-ui="list"
      >
        {DS_TYPE_TOKENS.map(token => {
          const isActive = token === target.activeToken;
          return (
            <button
              key={token}
              type="button"
              onClick={() => applyToken(token)}
              data-type-inspector-ui="option"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                background: isActive ? "rgba(120,170,255,0.18)" : "transparent",
                color: "#f4f4f4",
                border: "none",
                borderTop: "1px solid #333",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 11,
                  opacity: 0.7,
                  marginBottom: 4,
                }}
              >
                {token}{isActive && " · current"}
              </div>
              {/*
                Sample preview rendered with the actual token class so
                the user sees the real font / size / weight inline.
                Wrapped in a div with no inherited reset so the
                stylesheet rule fully owns the look.
              */}
              <div className={token} style={{ color: "#f4f4f4", margin: 0 }}>
                The quick brown fox
              </div>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
