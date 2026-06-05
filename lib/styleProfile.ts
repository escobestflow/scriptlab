// Style calibration — the "Style Lab" data model + pure math.
//
// See docs/style-calibration.md for the full design. In brief: the
// writer picks 3 of 15 varied prose samples per round; their picks
// move a learned style vector; on Lock we distill a rubric and freeze
// a StyleProfile that gets pasted into every script-prose prompt.
//
// This module is PURE — no React, no I/O. The locked profile persists
// by nesting inside WriterProfile (lib/writerProfile.ts); the in-
// progress training state lives in the StyleLab component / localStorage.

export const STYLE_PROFILE_VERSION = 1;

// ─── Axes ─────────────────────────────────────────────────────────────
// Seven craft axes. Each is a 0–1 scalar: 0 = the "low" pole, 1 = the
// "high" pole. The directive strings are what we splice into the
// sample-generation prompt at the low / mid / high ends of each axis,
// so editing these literally changes how variants read.

export type AxisKey =
  | "actionDialogue"
  | "subtext"
  | "density"
  | "register"
  | "emotion"
  | "sensory"
  | "surprise";

export interface StyleAxis {
  key: AxisKey;
  label: string;
  lowLabel: string;
  highLabel: string;
  /** Directive fragments injected into the sample prompt at three
   *  bands of the axis value. The sampler picks one by the coord. */
  low: string;
  mid: string;
  high: string;
}

export const STYLE_AXES: StyleAxis[] = [
  {
    key: "actionDialogue",
    label: "Action ↔ Dialogue",
    lowLabel: "Action-driven",
    highLabel: "Dialogue-driven",
    low: "Lean on action and description; sparse dialogue, let images carry the scene.",
    mid: "Balance action lines and dialogue evenly.",
    high: "Dialogue-forward; characters reveal the scene through what they say.",
  },
  {
    key: "subtext",
    label: "On-the-nose ↔ Oblique",
    lowLabel: "Direct",
    highLabel: "High subtext",
    low: "Characters say what they mean; intentions are explicit and clear.",
    mid: "Mix direct statements with some unspoken tension.",
    high: "Heavy subtext; characters talk around the real thing, meaning lives between the lines.",
  },
  {
    key: "density",
    label: "Terse ↔ Lush",
    lowLabel: "Terse",
    highLabel: "Lush",
    low: "Clipped, economical sentences. Short. Punchy. Lots of white space.",
    mid: "Moderate sentence length with natural rhythm.",
    high: "Flowing, layered sentences with rich clauses and momentum.",
  },
  {
    key: "register",
    label: "Plain ↔ Literary",
    lowLabel: "Plain",
    highLabel: "Literary",
    low: "Everyday, concrete vocabulary. Nothing showy.",
    mid: "Accessible but precise word choice.",
    high: "Elevated, literary diction; striking images and turns of phrase.",
  },
  {
    key: "emotion",
    label: "Restrained ↔ Heightened",
    lowLabel: "Restrained",
    highLabel: "Heightened",
    low: "Cool, controlled emotional register. Underplay everything.",
    mid: "Honest emotion without melodrama.",
    high: "Heightened, operatic emotion; let feeling run hot.",
  },
  {
    key: "sensory",
    label: "Sparse ↔ Sensory",
    lowLabel: "Sparse",
    highLabel: "Sensory",
    low: "Minimal sensory detail; just what the scene needs to function.",
    mid: "Selective sensory texture at key moments.",
    high: "Dense sensory detail — sound, light, smell, texture saturate the prose.",
  },
  {
    key: "surprise",
    label: "Conventional ↔ Unexpected",
    lowLabel: "Conventional",
    highLabel: "Unexpected",
    low: "Familiar, well-made choices; play the scene straight.",
    mid: "Mostly grounded with an occasional fresh angle.",
    high: "Subvert expectation; reach for the surprising image, line, or beat.",
  },
];

export const AXIS_KEYS: AxisKey[] = STYLE_AXES.map(a => a.key);

export type StyleCoord = Record<AxisKey, number>;

/** Neutral center of the space — every axis at 0.5. */
export function neutralCoord(): StyleCoord {
  const c = {} as StyleCoord;
  for (const k of AXIS_KEYS) c[k] = 0.5;
  return c;
}

// ─── Locked profile (nests inside WriterProfile) ──────────────────────

export interface StyleExemplar {
  text: string;
  coord: StyleCoord;
}

export interface StyleProfile {
  version: number;
  status: "locked";
  /** Global by default; a project may carry its own override. */
  scope: "global" | { projectId: string };
  axes: StyleCoord;
  /** Distilled, user-editable voice bible. */
  rubric: string;
  exemplars: StyleExemplar[];
  lockedAt: string;
}

// ─── Variance engine ──────────────────────────────────────────────────
// Spread `count` coordinates across the ACTIVE axes, centered on the
// current vector. Inactive axes are pinned to the current value so they
// don't add noise. We use a deterministic low-discrepancy-ish spread
// (golden-ratio jitter per axis) seeded by the round number so a given
// round is reproducible and the 15 samples are well-separated rather
// than clustered. No Math.random (it's banned in some runtimes and we
// want reproducibility).

const GOLDEN = 0.6180339887498949;

/** Generate `count` coordinates for one round.
 *  - center: the current learned vector
 *  - activeAxes: which axes vary this round
 *  - spread: half-width of exploration on each active axis (0–0.5)
 *  - round: seed for reproducibility */
export function sampleCoords(
  count: number,
  center: StyleCoord,
  activeAxes: AxisKey[],
  spread: number,
  round: number,
): StyleCoord[] {
  const active = new Set(activeAxes);
  const out: StyleCoord[] = [];
  for (let i = 0; i < count; i++) {
    const coord = { ...center } as StyleCoord;
    AXIS_KEYS.forEach((key, axisIdx) => {
      if (!active.has(key)) return;
      // Per-(sample, axis) phase via golden-ratio sequence → even spread.
      const phase = ((i + 1) * GOLDEN * (axisIdx + 1) + round * GOLDEN) % 1;
      // Map [0,1) phase to [-spread, +spread] offset around center.
      const offset = (phase * 2 - 1) * spread;
      coord[key] = clamp01(center[key] + offset);
    });
    out.push(coord);
  }
  return out;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Turn a coordinate into the directive block spliced into the sample
 *  prompt. Picks low/mid/high per axis by value band. */
export function coordToDirective(coord: StyleCoord): string {
  const lines = STYLE_AXES.map(axis => {
    const v = coord[axis.key] ?? 0.5;
    const frag = v < 0.34 ? axis.low : v > 0.66 ? axis.high : axis.mid;
    return `- ${frag}`;
  });
  return lines.join("\n");
}

/** Short human-readable label for a coord (for card badges). */
export function coordSummary(coord: StyleCoord): string {
  return STYLE_AXES
    .map(axis => {
      const v = coord[axis.key] ?? 0.5;
      if (v < 0.34) return axis.lowLabel;
      if (v > 0.66) return axis.highLabel;
      return null;
    })
    .filter(Boolean)
    .join(" · ") || "balanced";
}

// ─── Update rule ──────────────────────────────────────────────────────

/** Centroid of the selected coordinates. */
export function centroid(coords: StyleCoord[]): StyleCoord {
  const c = {} as StyleCoord;
  for (const k of AXIS_KEYS) {
    const sum = coords.reduce((acc, co) => acc + (co[k] ?? 0.5), 0);
    c[k] = coords.length ? sum / coords.length : 0.5;
  }
  return c;
}

/** Move the current vector toward the centroid of the picks.
 *  v_next = v + α·(centroid − v). α decays with convergence so later
 *  rounds fine-tune rather than swing. */
export function updateVector(
  current: StyleCoord,
  picks: StyleCoord[],
  alpha: number,
): StyleCoord {
  if (picks.length === 0) return current;
  const target = centroid(picks);
  const next = {} as StyleCoord;
  for (const k of AXIS_KEYS) {
    next[k] = clamp01(current[k] + alpha * (target[k] - current[k]));
  }
  return next;
}

// ─── Measurement ──────────────────────────────────────────────────────

/** Mean per-axis spread (avg absolute deviation from centroid) across a
 *  set of coords. 0 = identical picks, ~0.5 = maximally scattered.
 *
 *  Only axes that actually VARY across the picks are counted — a pinned
 *  axis (identical in every pick, e.g. an inactive dial) contributes to
 *  neither the numerator nor the denominator. Without this, scatter on
 *  the one axis in play gets diluted to "converged" by the 6 stable
 *  axes around it. */
export function spread(coords: StyleCoord[]): number {
  if (coords.length < 2) return 0;
  const ctr = centroid(coords);
  let total = 0;
  let n = 0;
  for (const k of AXIS_KEYS) {
    const vals = coords.map(co => co[k] ?? 0.5);
    const varies = Math.max(...vals) - Math.min(...vals) > 1e-9;
    if (!varies) continue; // skip pinned axes — don't dilute real scatter
    for (const v of vals) {
      total += Math.abs(v - ctr[k]);
      n++;
    }
  }
  return n ? total / n : 0;
}

/** Convergence score in [0,1]. 1 = picks tightly clustered (settled).
 *  Normalized so a spread of ~0.25 (loose) maps to ~0. */
export function convergence(picks: StyleCoord[]): number {
  const s = spread(picks);
  return clamp01(1 - s / 0.25);
}

/** Suggested learning rate for a round, decaying as convergence rises.
 *  Round 1 moves fast (0.6); converged rounds barely nudge (→0.15). */
export function alphaForRound(roundConvergence: number): number {
  return 0.15 + 0.45 * (1 - clamp01(roundConvergence));
}

/** Suggested exploration spread for the NEXT round, shrinking as the
 *  vector settles. Starts wide (0.35), tightens toward 0.1. */
export function spreadForRound(roundConvergence: number): number {
  return 0.1 + 0.25 * (1 - clamp01(roundConvergence));
}

// ─── Prompt injection ─────────────────────────────────────────────────

/** Render a locked profile into the cached system block that gets
 *  prepended to every script-prose prompt. This IS the "memory" —
 *  identical text every call ⇒ repeatable style. Returns "" when there's
 *  nothing meaningful to inject. */
export function renderStyleProfileForPrompt(profile: StyleProfile | null | undefined): string {
  if (!profile || profile.status !== "locked") return "";
  const axisLines = STYLE_AXES.map(axis => {
    const v = profile.axes[axis.key] ?? 0.5;
    const pct = Math.round(v * 100);
    const lean = v < 0.34 ? axis.lowLabel : v > 0.66 ? axis.highLabel : "balanced";
    return `- ${axis.label}: ${lean} (${pct}%)`;
  }).join("\n");

  const exemplarBlock = profile.exemplars.length
    ? `\n\nReference samples in the target voice (imitate their texture, not their content):\n${profile.exemplars
        .map((e, i) => `--- sample ${i + 1} ---\n${e.text.trim()}`)
        .join("\n\n")}`
    : "";

  return `## WRITER STYLE PROFILE (high priority — shape ALL prose to match this voice)
The writer has calibrated a specific prose voice. Match it.

${profile.rubric.trim()}

Style targets:
${axisLines}${exemplarBlock}`;
}
