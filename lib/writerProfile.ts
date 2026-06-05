// Writer profile — per-user, cumulative model of creative preferences
// and prose voice that we inject into every AI prompt so generations
// bias toward the patterns this specific user has chosen before.
//
// TWO SIGNAL STREAMS
//   1) Categorical signals — every chip/toggle the user clicks on (genres,
//      subgenres, tones, themes, writer styles, reference aspects, etc.).
//      Stored as `count + firstSeen + lastSeen` per distinct value. This
//      is high-confidence preference data.
//   2) Prose style metrics — running averages of heuristic features pulled
//      from text the user has committed (loglines, summaries, character
//      fields, beats, scenes). Tracks dialogue density, sentence length,
//      punctuation tics, vocabulary richness, etc.
//
// The profile never deletes — it always grows. Noise gets diluted by
// volume over time. At render time we take top-N per category so the
// prompt stays compact.
//
// This module is PURE — no React, no I/O. Persistence and hook wiring
// live in `writerProfileStore.ts`.

export const PROFILE_SCHEMA_VERSION = 1;

// ─── Types ────────────────────────────────────────────────────────────

/** Running count + recency metadata for a single choice key. */
export interface ProfileSignal {
  count: number;
  firstSeen: string; // ISO timestamp of first time we saw it
  lastSeen: string;  // ISO timestamp of most recent time
}

/** Categorical signal buckets. Each bucket is { normalized key → signal }.  */
export type ProfileCategory =
  | "projectTypes"
  | "genres"
  | "subGenres"
  | "tones"
  | "themes"
  | "endingTypes"
  | "writerStyles"
  | "referenceTitles"
  | "referenceAspects";

export type CategoricalBucket = Record<string, ProfileSignal>;

/** Heuristic prose features, all stored as running averages. */
export interface StyleMetrics {
  /** Mean words per sentence. */
  sentenceLenAvg: number;
  /** Fraction of non-empty lines that look like dialogue (0–1). */
  dialogueDensity: number;
  /** Type-token ratio, a crude proxy for vocabulary richness. */
  vocabularyRichness: number;
  /** Em-dashes per 1000 words. */
  emdashPer1k: number;
  /** Ellipses per 1000 words. */
  ellipsisPer1k: number;
  /** Exclamation marks per 1000 words. */
  exclamationPer1k: number;
  /** Question marks per 1000 words. */
  questionPer1k: number;
  /** Average adverb frequency (-ly words per 1000 words). */
  adverbPer1k: number;
  /** Total samples that contributed to the running averages above. */
  sampleCount: number;
  /** Total words ingested across all samples. */
  totalWords: number;
}

/** A short verbatim fragment of the user's own prose, kept as an exemplar. */
export interface ProfileExemplar {
  text: string;
  kind: "logline" | "summary" | "tone" | "beat" | "scene" | "moment" | "character";
  capturedAt: string;
}

export interface WriterProfile {
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  /** Total discrete capture events (signals + samples). Drives summary refresh cadence. */
  totalEvents: number;
  preferences: Record<ProfileCategory, CategoricalBucket>;
  style: StyleMetrics;
  /** Bounded LIFO of short verbatim snippets, newest first. */
  exemplars: ProfileExemplar[];
  /** Locked prose-style calibration from the Style Lab. Optional —
   *  absent until the user locks a profile. Nested here (rather than a
   *  separate table) so it persists via the existing writer_profiles
   *  round-trip AND ships to the server in the same `profile` request
   *  param that prompts already read. Typed as `unknown` here to avoid
   *  a circular import with lib/styleProfile.ts; callers cast to
   *  StyleProfile. */
  styleProfile?: import("./styleProfile").StyleProfile | null;
}

// ─── Constructors ─────────────────────────────────────────────────────

export function emptyStyleMetrics(): StyleMetrics {
  return {
    sentenceLenAvg: 0,
    dialogueDensity: 0,
    vocabularyRichness: 0,
    emdashPer1k: 0,
    ellipsisPer1k: 0,
    exclamationPer1k: 0,
    questionPer1k: 0,
    adverbPer1k: 0,
    sampleCount: 0,
    totalWords: 0,
  };
}

export function emptyProfile(): WriterProfile {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    totalEvents: 0,
    preferences: {
      projectTypes: {},
      genres: {},
      subGenres: {},
      tones: {},
      themes: {},
      endingTypes: {},
      writerStyles: {},
      referenceTitles: {},
      referenceAspects: {},
    },
    style: emptyStyleMetrics(),
    exemplars: [],
  };
}

// ─── Mutations (all pure, return a new profile) ───────────────────────

/** Case-fold + collapse whitespace so "Thriller " and "thriller" merge. */
function normKey(s: string): string {
  return String(s).trim().toLowerCase().replace(/\s+/g, " ");
}

export function recordSignal(
  profile: WriterProfile,
  category: ProfileCategory,
  rawValue: string,
): WriterProfile {
  const value = normKey(rawValue);
  if (!value) return profile;
  const now = new Date().toISOString();
  const bucket = profile.preferences[category] ?? {};
  const prev = bucket[value];
  const next: ProfileSignal = prev
    ? { count: prev.count + 1, firstSeen: prev.firstSeen, lastSeen: now }
    : { count: 1, firstSeen: now, lastSeen: now };
  return {
    ...profile,
    updatedAt: now,
    totalEvents: profile.totalEvents + 1,
    preferences: {
      ...profile.preferences,
      [category]: { ...bucket, [value]: next },
    },
  };
}

/** Convenience: record several values into the same category at once. */
export function recordSignals(
  profile: WriterProfile,
  category: ProfileCategory,
  values: string[],
): WriterProfile {
  return values.reduce((acc, v) => recordSignal(acc, category, v), profile);
}

// ─── Style analysis ───────────────────────────────────────────────────

const MAX_EXEMPLARS = 12;
const EXEMPLAR_MIN_WORDS = 6;
const EXEMPLAR_MAX_CHARS = 400;

export interface StyleSample {
  sentenceLenAvg: number;
  dialogueDensity: number;
  vocabularyRichness: number;
  emdashPer1k: number;
  ellipsisPer1k: number;
  exclamationPer1k: number;
  questionPer1k: number;
  adverbPer1k: number;
  wordCount: number;
}

/**
 * Extract heuristic style features from an arbitrary prose sample.
 * Returns a per-sample reading that can be folded into a running
 * average via `foldStyleSample`. Empty / too-short input returns null.
 */
export function analyzeText(text: string): StyleSample | null {
  if (!text) return null;
  const s = text.trim();
  if (s.length < 20) return null;

  const words = s.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const wordCount = words.length;
  if (wordCount < 5) return null;

  // Sentence split on .!? (not inside ellipsis).
  const sentenceCount = Math.max(1, (s.match(/[.!?]+/g) ?? []).length);
  const sentenceLenAvg = wordCount / sentenceCount;

  // Dialogue density: lines that start with ALL-CAPS name (screenplay cue)
  // OR that are wrapped in quotes OR that start with a dash.
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const dialogueLines = lines.filter(l =>
    /^[A-Z][A-Z .'()-]{1,40}$/.test(l) ||      // screenplay character cue
    /^["“].+["”]$/.test(l) ||                    // fully quoted line
    /^["“]/.test(l) ||                            // line starts with a quote
    /^[—-]\s/.test(l),                            // dash-led dialogue (prose)
  ).length;
  const dialogueDensity = lines.length ? dialogueLines / lines.length : 0;

  // Type-token ratio — vocabulary richness. Cap at 1.
  const uniq = new Set(words.map(w => w.toLowerCase())).size;
  const vocabularyRichness = uniq / wordCount;

  const per1k = (n: number) => (wordCount > 0 ? (n * 1000) / wordCount : 0);
  const emdashCount    = (s.match(/—|--/g) ?? []).length;
  const ellipsisCount  = (s.match(/…|\.\.\./g) ?? []).length;
  const exclamation    = (s.match(/!/g) ?? []).length;
  const question       = (s.match(/\?/g) ?? []).length;
  const adverbCount    = (s.match(/\b\w+ly\b/gi) ?? []).length;

  return {
    sentenceLenAvg,
    dialogueDensity,
    vocabularyRichness,
    emdashPer1k: per1k(emdashCount),
    ellipsisPer1k: per1k(ellipsisCount),
    exclamationPer1k: per1k(exclamation),
    questionPer1k: per1k(question),
    adverbPer1k: per1k(adverbCount),
    wordCount,
  };
}

/**
 * Fold a single sample into a running word-weighted average.
 * Weighting by word count means a 500-word scene contributes more than
 * a 10-word fragment, which is what we want for style signal.
 */
function weightedFold(prev: number, prevWeight: number, sample: number, sampleWeight: number): number {
  const total = prevWeight + sampleWeight;
  if (total === 0) return 0;
  return (prev * prevWeight + sample * sampleWeight) / total;
}

export function foldStyleSample(metrics: StyleMetrics, sample: StyleSample): StyleMetrics {
  const w = sample.wordCount;
  const pw = metrics.totalWords;
  return {
    sentenceLenAvg:      weightedFold(metrics.sentenceLenAvg,      pw, sample.sentenceLenAvg,      w),
    dialogueDensity:     weightedFold(metrics.dialogueDensity,     pw, sample.dialogueDensity,     w),
    vocabularyRichness:  weightedFold(metrics.vocabularyRichness,  pw, sample.vocabularyRichness,  w),
    emdashPer1k:         weightedFold(metrics.emdashPer1k,         pw, sample.emdashPer1k,         w),
    ellipsisPer1k:       weightedFold(metrics.ellipsisPer1k,       pw, sample.ellipsisPer1k,       w),
    exclamationPer1k:    weightedFold(metrics.exclamationPer1k,    pw, sample.exclamationPer1k,    w),
    questionPer1k:       weightedFold(metrics.questionPer1k,       pw, sample.questionPer1k,       w),
    adverbPer1k:         weightedFold(metrics.adverbPer1k,         pw, sample.adverbPer1k,         w),
    sampleCount: metrics.sampleCount + 1,
    totalWords:  pw + w,
  };
}

/**
 * Record a prose sample: updates running style averages, and optionally
 * keeps the sample as an exemplar (short enough + above minimum length).
 * Dedupes by exact text so re-saving the same draft doesn't double-count.
 */
export function recordStyleSample(
  profile: WriterProfile,
  rawText: string,
  kind: ProfileExemplar["kind"],
): WriterProfile {
  const sample = analyzeText(rawText);
  if (!sample) return profile;
  const now = new Date().toISOString();
  const style = foldStyleSample(profile.style, sample);

  // Exemplar inclusion: only if short enough to inject cheaply and long
  // enough to carry signal. Dedupe against existing exemplars.
  let exemplars = profile.exemplars;
  const trimmed = rawText.trim();
  const wordCount = sample.wordCount;
  if (
    wordCount >= EXEMPLAR_MIN_WORDS &&
    trimmed.length <= EXEMPLAR_MAX_CHARS &&
    !exemplars.some(e => e.text === trimmed)
  ) {
    exemplars = [{ text: trimmed, kind, capturedAt: now }, ...exemplars].slice(0, MAX_EXEMPLARS);
  }

  return {
    ...profile,
    updatedAt: now,
    totalEvents: profile.totalEvents + 1,
    style,
    exemplars,
  };
}

// ─── Prompt rendering ─────────────────────────────────────────────────

/** Pick the top-N keys by count from a bucket, sorted desc. */
function topKeys(bucket: CategoricalBucket, n: number): Array<[string, ProfileSignal]> {
  return Object.entries(bucket)
    .sort((a, b) => b[1].count - a[1].count || (b[1].lastSeen > a[1].lastSeen ? 1 : -1))
    .slice(0, n);
}

function formatTopList(bucket: CategoricalBucket, n: number): string {
  const top = topKeys(bucket, n);
  if (!top.length) return "(none yet)";
  return top.map(([k, v]) => `${k} (×${v.count})`).join(", ");
}

/**
 * Is this profile rich enough to justify prompt injection?
 * Skip injection entirely for near-empty profiles so we don't pollute
 * first-time users with empty signal.
 */
export function isProfileMeaningful(profile: WriterProfile | null | undefined): boolean {
  if (!profile) return false;
  // At least one categorical signal OR at least one analyzed prose sample.
  const hasSignals = Object.values(profile.preferences).some(bucket => Object.keys(bucket).length > 0);
  const hasStyle = profile.style.sampleCount > 0;
  return hasSignals || hasStyle;
}

/**
 * Compile the profile into a compact natural-language block the model
 * can read. Keep this tight — every token costs on every request.
 */
export function renderProfileForPrompt(profile: WriterProfile | null | undefined): string {
  if (!isProfileMeaningful(profile)) return "";
  const p = profile!;
  const pref = p.preferences;

  const lines: string[] = [];
  lines.push("# WRITER PROFILE");
  lines.push("Cumulative signal from this user's past choices and prose. Bias your output toward these patterns without caricaturing them. Do not force any single item — they are a taste fingerprint, not a checklist.");
  lines.push("");
  lines.push("## Creative preferences (weighted by frequency)");
  if (Object.keys(pref.projectTypes).length)      lines.push(`- Formats: ${formatTopList(pref.projectTypes, 3)}`);
  if (Object.keys(pref.genres).length)            lines.push(`- Genres: ${formatTopList(pref.genres, 6)}`);
  if (Object.keys(pref.subGenres).length)         lines.push(`- Sub-genres: ${formatTopList(pref.subGenres, 6)}`);
  if (Object.keys(pref.tones).length)             lines.push(`- Tones: ${formatTopList(pref.tones, 5)}`);
  if (Object.keys(pref.themes).length)            lines.push(`- Themes: ${formatTopList(pref.themes, 8)}`);
  if (Object.keys(pref.endingTypes).length)       lines.push(`- Ending preferences: ${formatTopList(pref.endingTypes, 5)}`);
  if (Object.keys(pref.writerStyles).length)      lines.push(`- Writer voices they echo: ${formatTopList(pref.writerStyles, 8)}`);
  if (Object.keys(pref.referenceTitles).length)   lines.push(`- Reference films/shows: ${formatTopList(pref.referenceTitles, 8)}`);
  if (Object.keys(pref.referenceAspects).length)  lines.push(`- Craft aspects they value: ${formatTopList(pref.referenceAspects, 8)}`);

  if (p.style.sampleCount > 0) {
    lines.push("");
    lines.push(`## Voice metrics (from ${p.style.sampleCount} saved sample${p.style.sampleCount === 1 ? "" : "s"}, ${Math.round(p.style.totalWords)} words)`);
    lines.push(`- Avg sentence length: ${p.style.sentenceLenAvg.toFixed(1)} words`);
    lines.push(`- Dialogue density: ${(p.style.dialogueDensity * 100).toFixed(0)}%`);
    lines.push(`- Vocabulary richness (type/token): ${p.style.vocabularyRichness.toFixed(2)}`);
    const punct: string[] = [];
    if (p.style.emdashPer1k      >= 0.5) punct.push(`em-dash (${p.style.emdashPer1k.toFixed(1)}/1k)`);
    if (p.style.ellipsisPer1k    >= 0.5) punct.push(`ellipsis (${p.style.ellipsisPer1k.toFixed(1)}/1k)`);
    if (p.style.exclamationPer1k >= 0.5) punct.push(`exclamation (${p.style.exclamationPer1k.toFixed(1)}/1k)`);
    if (p.style.questionPer1k    >= 0.5) punct.push(`question (${p.style.questionPer1k.toFixed(1)}/1k)`);
    if (p.style.adverbPer1k      >= 1)   punct.push(`-ly adverbs (${p.style.adverbPer1k.toFixed(1)}/1k)`);
    if (punct.length) lines.push(`- Punctuation habits: ${punct.join(", ")}`);
  }

  if (p.exemplars.length) {
    lines.push("");
    lines.push("## Recent exemplars from their own writing");
    for (const ex of p.exemplars.slice(0, 5)) {
      // One-line preview: collapse newlines, clamp length.
      const preview = ex.text.replace(/\s+/g, " ").slice(0, 200);
      lines.push(`- [${ex.kind}] "${preview}${ex.text.length > 200 ? "…" : ""}"`);
    }
  }

  return lines.join("\n");
}
