// ============================================================
// V2 desktop hero gradient configurator — helpers + defaults
// ============================================================
//
// The v2 desktop project-detail hero (.v2-desktop-hero-image) paints
// a stack of three gradient layers as a `::after` pseudo-element
// overlay (see app/globals.css). Layer set, ported from the user's
// Figma Make "Desktop Unfold" prototype:
//
//   1. Radial vignette  — ellipse 764×445 at center, transparent core
//                         that fades to opaque white at the edges
//   2. Linear right edge — white→transparent fade, 270deg
//   3. Linear left edge  — white→transparent fade, 90deg
//
// This module owns the *parameterized* form of those layers so a
// React configurator UI (in Studio.tsx) can mutate them live. The
// rendered CSS goes back into the hero via a `--hero-gradient-bg`
// CSS custom property; the static rule in globals.css falls back to
// the same default values when the variable isn't set.
//
// Everything here is purely a data layer — no React, no DOM. The
// rendering layer (Studio.tsx) imports `DEFAULT_HERO_GRADIENT` and
// `buildHeroGradientCSS()` and is responsible for state + IO.

export type RadialShape = "ellipse" | "circle";

/** One stop in a CSS gradient: color (hex) + alpha (0..1) + position (%). */
export interface GradientStop {
  /** Hex color string, e.g. "#FFFFFF". Used for the RGB channel of rgba(). */
  color: string;
  /** Alpha 0..1. Used for the A channel of rgba(). */
  alpha: number;
  /** Stop position in PERCENT (0..100). */
  stop: number;
}

/** Radial-gradient layer config (layer 1 — center vignette). */
export interface RadialLayer {
  enabled: boolean;
  shape: RadialShape;
  /** Ellipse/circle width in pixels. */
  width: number;
  /** Ellipse/circle height in pixels. (Ignored for `circle`; CSS treats it as a single radius.) */
  height: number;
  /** Horizontal center position, in PERCENT. */
  posX: number;
  /** Vertical center position, in PERCENT. */
  posY: number;
  /** Inner stop — typically transparent or near-transparent. */
  inner: GradientStop;
  /** Outer stop — typically opaque white. */
  outer: GradientStop;
}

/** Linear-gradient layer config (layers 2+3 — directional edge fades). */
export interface LinearLayer {
  enabled: boolean;
  /** Angle in degrees. 0deg paints bottom→top; 90 left→right; 180 top→bottom; 270 right→left. */
  angle: number;
  /** Starting stop (the painted-color end of the fade). */
  start: GradientStop;
  /** Ending stop (typically transparent — the same RGB at alpha 0). */
  end: GradientStop;
}

export interface HeroGradientConfig {
  radial: RadialLayer;
  right: LinearLayer;
  left: LinearLayer;
}

/** Mirror of the values currently baked into globals.css. */
export const DEFAULT_HERO_GRADIENT: HeroGradientConfig = {
  radial: {
    enabled: true,
    shape: "ellipse",
    width: 764,
    height: 445,
    posX: 50,
    posY: 50,
    inner: { color: "#FFFFFF", alpha: 0, stop: 28.365 },
    outer: { color: "#FFFFFF", alpha: 1, stop: 47.115 },
  },
  right: {
    enabled: true,
    angle: 270,
    start: { color: "#FFFFFF", alpha: 1, stop: 0 },
    end:   { color: "#FFFFFF", alpha: 0, stop: 22.008 },
  },
  left: {
    enabled: true,
    angle: 90,
    start: { color: "#FFFFFF", alpha: 1, stop: 1.6622 },
    end:   { color: "#FFFFFF", alpha: 0, stop: 24.645 },
  },
};

/** Parse "#RRGGBB" (or "RRGGBB") into [r, g, b] in 0..255. Falls back to white on parse failure. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const h = m[1];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Render a `GradientStop` as a CSS `rgba(...)` literal. Alpha clamped to 0..1. */
function rgba(stop: GradientStop): string {
  const [r, g, b] = hexToRgb(stop.color);
  const a = Math.max(0, Math.min(1, stop.alpha));
  // 3-decimal-place alpha is plenty for visual fidelity and keeps the
  // emitted string short for the copy-to-clipboard textarea.
  const aStr = a === 1 ? "1" : a === 0 ? "0" : a.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `rgba(${r}, ${g}, ${b}, ${aStr})`;
}

/** Render a stop's position as `N%`, trimming trailing zeros for a tidier output string. */
function pct(n: number): string {
  // CSS accepts arbitrary float precision; we just trim insignificant
  // trailing zeros so 47.115 stays "47.115%" and 0 stays "0%".
  const s = Number(n).toFixed(4);
  return `${s.replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/** Build the comma-separated `background-image` value for the three layers.
 *  Layers with `enabled: false` are dropped. When all three are disabled,
 *  returns `"none"` so the CSS rule still parses cleanly. */
export function buildHeroGradientCSS(c: HeroGradientConfig): string {
  const layers: string[] = [];
  if (c.radial.enabled) {
    const size = c.radial.shape === "circle"
      ? `${c.radial.width}px`
      : `${c.radial.width}px ${c.radial.height}px`;
    layers.push(
      `radial-gradient(${c.radial.shape} ${size} at ${pct(c.radial.posX)} ${pct(c.radial.posY)}, ${rgba(c.radial.inner)} ${pct(c.radial.inner.stop)}, ${rgba(c.radial.outer)} ${pct(c.radial.outer.stop)})`
    );
  }
  if (c.right.enabled) {
    layers.push(
      `linear-gradient(${c.right.angle}deg, ${rgba(c.right.start)} ${pct(c.right.start.stop)}, ${rgba(c.right.end)} ${pct(c.right.end.stop)})`
    );
  }
  if (c.left.enabled) {
    layers.push(
      `linear-gradient(${c.left.angle}deg, ${rgba(c.left.start)} ${pct(c.left.start.stop)}, ${rgba(c.left.end)} ${pct(c.left.end.stop)})`
    );
  }
  return layers.length > 0 ? layers.join(", ") : "none";
}
