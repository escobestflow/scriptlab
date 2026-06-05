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
  | "humor"
  | "grit"
  | "vulgarity"
  | "unpredictability"
  | "wit"
  | "tension";

export interface StyleAxis {
  key: AxisKey;
  /** Short trait name in the writer's own language. */
  label: string;
  /** One-line plain-English description of what the dial does, with a
   *  reference touchstone so it's instantly graspable. Shown under the
   *  slider in the UI. */
  blurb: string;
  lowLabel: string;
  highLabel: string;
  /** Directive fragments injected into the sample prompt at three bands
   *  of the axis value. The sampler picks one by the coord. */
  low: string;
  mid: string;
  high: string;
}

// Axes grounded in the writer's stated taste — A24 grit, Breaking Bad
// texture, Succession wit + vulgarity, Chappelle / Louie CK dark humor,
// misdirection over cliché. Each is a 0–1 dial; the always-on "voice
// DNA" (dark humor underneath, zero clichés) lives in the base preamble
// (BASE_STYLE_DNA below) so it's present in every sample regardless of
// where the dials sit.
export const STYLE_AXES: StyleAxis[] = [
  {
    key: "humor",
    label: "Darkly funny",
    blurb: "How hard the dark comedy hits — Chappelle / Louie CK energy.",
    lowLabel: "Straight",
    highLabel: "Darkly funny",
    low: "Play it straight here — let the weight land without a joke.",
    mid: "Let dark humor flicker through — wry and dry, never goofy.",
    high: "Lean into the dark comedy — find the funny in the bleakness (Chappelle / Louie CK), but earn it; never silly.",
  },
  {
    key: "grit",
    label: "Gritty",
    blurb: "Polished and clean vs. raw and lived-in — A24, Breaking Bad.",
    lowLabel: "Clean",
    highLabel: "Gritty",
    low: "Clean, composed prose.",
    mid: "Some texture and grime under the surface.",
    high: "Gritty and raw — A24 / Breaking Bad texture: lived-in, unglamorous, real.",
  },
  {
    key: "vulgarity",
    label: "Vulgar",
    blurb: "How crude the language gets — Succession-grade, but varied.",
    lowLabel: "Clean",
    highLabel: "Vulgar",
    low: "Keep the language clean here.",
    mid: "Curse sparingly, for impact — varied, never wallpaper.",
    high: "Crude and profane — Succession-grade vulgarity, but make each one land, never filler.",
  },
  {
    key: "unpredictability",
    label: "Unpredictable",
    blurb: "Misdirection and twists — when they expect right, go left.",
    lowLabel: "Conventional",
    highLabel: "Unpredictable",
    low: "Play the expected beat cleanly.",
    mid: "Bend one expectation; slip in a small turn.",
    high: "Subvert it — misdirection, a hard turn they didn't see coming. When the audience leans right, go left.",
  },
  {
    key: "wit",
    label: "Witty",
    blurb: "Razor-sharp cleverness in the lines — Succession-smart.",
    lowLabel: "Earnest",
    highLabel: "Witty",
    low: "Earnest, plain-spoken.",
    mid: "A flash of cleverness in the phrasing.",
    high: "Razor-witted — Succession-sharp; the smartest person in the room is writing the line.",
  },
  {
    key: "tension",
    label: "Cliffhanger",
    blurb: "Neat resolution vs. leave-them-hanging charge.",
    lowLabel: "Settled",
    highLabel: "Cliffhanger",
    low: "Let the moment resolve and breathe.",
    mid: "Leave a little charge in the air.",
    high: "End on a held breath — an open loop, a cliffhanger that demands the next page.",
  },
];

/** Always-on voice DNA — the writer's identity that holds at EVERY dial
 *  setting. Sent from the Style Lab as the sample base so even round 1
 *  reads like them; the per-coordinate directive layers the dials on
 *  top. (Hardcoded to the owner's taste for now since the tool is
 *  admin-only; would become per-user when ungated.) */
export const BASE_STYLE_DNA =
  "VOICE DNA — apply underneath everything, at every setting:\n" +
  "- Gritty, creative, lived-in — an A24 sensibility.\n" +
  "- A dark sense of humor runs under it all (Dave Chappelle, Louie CK): find the funny in the bleak, but earn it — never goofy.\n" +
  "- Clever and unpredictable: misdirection and sharp turns; when the audience leans right, go left.\n" +
  "- ZERO clichés — not in phrasing, not in image, not in beat. If a line feels familiar, cut it.\n" +
  "- Wit in the dialogue, Succession-sharp.\n" +
  "- Profanity is welcome but VARIED and purposeful — never constant filler.\n" +
  "- Favor tension and cliffhangers over neat, tidy resolution.";

export const AXIS_KEYS: AxisKey[] = STYLE_AXES.map(a => a.key);

export type StyleCoord = Record<AxisKey, number>;

/** Neutral center of the space — every axis at 0.5. */
export function neutralCoord(): StyleCoord {
  const c = {} as StyleCoord;
  for (const k of AXIS_KEYS) c[k] = 0.5;
  return c;
}

/** Seed coordinate reflecting the writer's stated leanings, so round 1
 *  already starts near their taste and refines from there rather than
 *  exploring from a blank neutral. Vulgarity sits mid ("varied, not
 *  constant"); everything else leans high. */
export function seedCoord(): StyleCoord {
  return {
    humor: 0.8,
    grit: 0.8,
    vulgarity: 0.55,
    unpredictability: 0.85,
    wit: 0.78,
    tension: 0.7,
  };
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
