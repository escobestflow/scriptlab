// Client-side importer: takes a .txt or .pdf file the user uploaded and
// turns it into a Scene[] we can drop into the Script layer.
//
// The pipeline is:
//   1. Extract plaintext from the file (fast-path for .txt, pdfjs for .pdf).
//   2. Split that text into scenes on scene-heading prefixes
//      (INT. / EXT. / EST. / INT/EXT. / I/E.). Each scene gets a fresh
//      id and `beatId: null` — the Scene has no originating beat because
//      the user didn't outline first.
//   3. The caller drops the Scene[] into the active Script draft, then
//      kicks off `syncLayers(story, "script", ["concept","characters","story"])`
//      to derive the other three layers from the imported script.
//
// PDF extraction runs entirely in the browser via a dynamic import of
// `pdfjs-dist`, so the server-side bundle isn't weighed down. The worker
// script is pinned to the same version as the package we installed.

import type { Beat, Character, Scene } from "./story";
import { parseScreenplay } from "./scriptParse";

/** Accepted by the file-picker UI. */
export const IMPORT_ACCEPT = ".txt,.pdf,text/plain,application/pdf";

// Scene-heading detector. Matches the standard screenplay slug prefixes
// (INT. / EXT. / EST. / INT./EXT. / I/E.) — optionally preceded by a
// shooting-script scene number like "1 ", "25A ", or "1. ". Without the
// optional prefix, professional shooting-script PDFs (which *always*
// number their scenes) would slip past the detector and the splitter
// would fall through to the single-"SCRIPT" fallback, which is exactly
// the symptom we hit on a user-uploaded PDF.
const SCENE_HEADING_RE =
  /^(?:[A-Z]?\d+[A-Z]?[.)]?\s+)?(INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?)\b/i;

// ── Top-level dispatch ─────────────────────────────────────────────

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  // Trust the extension over the MIME type — browsers are inconsistent
  // about labelling .fountain as text/plain vs application/octet-stream.
  if (name.endsWith(".txt") || name.endsWith(".fountain")) {
    return await file.text();
  }
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return await extractTextFromPdf(file);
  }
  throw new Error(
    `Unsupported file type: ${file.name}. Please upload a .txt or .pdf file.`
  );
}

// ── PDF extraction (browser-side pdfjs) ────────────────────────────
//
// We use the "legacy" build of pdfjs because it runs in both worker and
// non-worker mode and ships the ESM module we can dynamic-import. Worker
// is pulled from a CDN pinned to the same version as the npm package so
// we don't have to copy it into /public.

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Worker source: using CDN avoids bundler gymnastics and keeps the
  // server build clean. The version segment must match package.json.
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;

  const allPages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    allPages.push(reconstructPageText(content.items));
  }
  return allPages.join("\n\n");
}

// pdfjs returns text as a flat list of positioned glyph-runs. To get
// something resembling the original layout we:
//   - sort items by Y (descending — PDF origin is bottom-left)
//   - within the same Y-band (~2pt tolerance), sort by X
//   - emit a newline whenever the Y changes, a space for same-line runs
//   - honor hasEOL when the item declares one
//
// This won't be perfect — screenplays with two-column action/dialogue
// formats can bleed across columns — but it's "good enough" for the
// downstream scene-heading split, which only needs INT./EXT. to start
// at the beginning of a line.

interface PdfTextItem {
  str: string;
  transform: number[];        // [a,b,c,d,e,f] — e = x, f = y
  hasEOL?: boolean;
  height?: number;
}

function reconstructPageText(rawItems: any[]): string {
  const items: PdfTextItem[] = rawItems.filter(
    (it: any) => it && typeof it.str === "string" && Array.isArray(it.transform)
  );
  if (items.length === 0) return "";

  // Bucket purely by Y position, ignoring pdfjs's stream order. The
  // earlier "walk-in-order, compare to last line" approach was brittle:
  // for screenplay PDFs whose content stream isn't strictly top-down
  // (any PDF with side-margin scene numbers, page headers, or dual-
  // column dialogue), items from different visual lines arrive
  // interleaved, and the sequential grouping scatters them across
  // dozens of spurious line entries. The consequence in practice:
  // "INT." and "LIVING ROOM - DAY" land on different lines, the
  // scene-heading regex never matches a trimmed line, and the whole
  // script collapses into the single-"SCRIPT" fallback.
  //
  // Pure Y-bucketing is order-independent: every item lands in the
  // bucket whose Y it's closest to (within ~2pt), regardless of which
  // order pdfjs emitted it in. Then we sort buckets top-to-bottom and
  // within each bucket sort items left-to-right by X.
  const TOLERANCE = 2;
  const buckets: { y: number; items: PdfTextItem[] }[] = [];
  for (const it of items) {
    const y = it.transform[5];
    const bucket = buckets.find(b => Math.abs(b.y - y) <= TOLERANCE);
    if (bucket) {
      bucket.items.push(it);
    } else {
      buckets.push({ y, items: [it] });
    }
  }

  // PDF origin is bottom-left, so higher Y = higher on the page.
  buckets.sort((a, b) => b.y - a.y);

  const lines: string[] = [];
  for (const bucket of buckets) {
    bucket.items.sort((a, b) => a.transform[4] - b.transform[4]);
    const line = bucket.items.map(it => it.str).join("").replace(/\s+$/u, "");
    if (line.length > 0) lines.push(line);
  }
  return lines.join("\n");
}

// ── Scene splitting ────────────────────────────────────────────────

/**
 * Break raw screenplay text into a Scene[]. Any content before the first
 * scene heading (title page, etc.) is dropped. If the file contains no
 * recognizable scene headings at all, returns an empty array — callers
 * must treat this as an import failure and surface a clear error. (We
 * used to fall back to a single "SCRIPT" scene containing the whole
 * blob, but that silently fed the AI a title-page-shaped input and
 * produced one-character / one-beat imports that misled the user into
 * thinking the import "worked".)
 */
export function splitScriptIntoScenes(text: string): Scene[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  interface Block { heading: string; body: string[]; }
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (SCENE_HEADING_RE.test(trimmed)) {
      if (current) blocks.push(current);
      current = { heading: trimmed, body: [] };
    } else if (current) {
      current.body.push(line);
    }
    // Lines before the first heading are dropped (preamble / title page).
  }
  if (current) blocks.push(current);

  return blocks.map(b => ({
    id: sceneId(),
    beatId: null,
    heading: b.heading.toUpperCase(),
    content: trimBlank(b.body).join("\n"),
    notes: "",
  }));
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

function sceneId(): string {
  return `sc_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Deterministic extractors (no AI) ──────────────────────────────
//
// When a user uploads a finished screenplay, the import must be a
// FAITHFUL copy of what's in the file — not an AI interpretation.
// Character names are taken verbatim from dialogue cues; beats are
// one-per-scene with scene content copy-pasted into beat.sceneContent
// and status="written"; scenes in the Script layer are linked back to
// their originating beats so the sync-state logic stays coherent.
//
// The only AI-driven piece that used to live in the import pipeline
// was Concept inference (logline/summary/tone/themes). We now skip
// Concept entirely at import time — it's interpretive and the user
// didn't ask for it. They can run "Update Other Layers" from the
// Script tab later if they want a derived logline.

/**
 * Extract the unique set of speaking characters from a sequence of
 * scenes. Walks every dialogue cue (via the existing screenplay
 * parser), preserves first-appearance order, and returns Character
 * records with just `name` populated. Other fields are left empty so
 * the user can fill them in — we refuse to invent backstory or arcs
 * the script doesn't explicitly contain.
 */
export function extractCharactersFromScenes(scenes: Scene[]): Character[] {
  const seen = new Set<string>();     // upper-cased for dedupe only
  const ordered: string[] = [];        // original casing, first-appearance order

  for (const scene of scenes) {
    const chunks = parseScreenplay(scene.content || "");
    for (const c of chunks) {
      if (c.kind !== "dialogue") continue;
      const raw = (c.character || "").trim();
      if (!raw) continue;
      const key = raw.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(raw);
    }
  }

  return ordered.map(name => ({
    id: characterId(),
    name,
    role: "",
    archetype: "",
    backstory: "",
    motivations: "",
    flaws: "",
    want: "",
    need: "",
    relationships: [],
    voice: "",
    arc: "",
    notes: "",
  }));
}

/**
 * Build a 1:1 beat-per-scene mapping from imported scenes. Each beat:
 *   - `name`   = scene-heading location (INT./EXT. prefix + time suffix stripped)
 *   - `summary`= "" (user fills in)
 *   - `status` = "written" (the script is already written)
 *   - `sceneContent` = exact scene content (copy-paste)
 * The returned `scenes` have their `beatId` set to the new beat's id so
 * Script-layer and Story-layer data stay in sync.
 */
export function extractBeatsFromScenes(
  scenes: Scene[],
): { beats: Beat[]; scenes: Scene[] } {
  const newBeats: Beat[] = [];
  const linkedScenes: Scene[] = [];

  scenes.forEach((scene, i) => {
    const bid = beatId();
    newBeats.push({
      id: bid,
      name: deriveBeatName(scene.heading, i),
      summary: "",
      purpose: "",
      position: i,
      momentIds: [],
      characterIds: [],
      status: "written",
      sceneContent: scene.content,
    });
    linkedScenes.push({ ...scene, beatId: bid });
  });

  return { beats: newBeats, scenes: linkedScenes };
}

// Turn a slug-style scene heading into a short, human-readable beat
// name. "INT. TACO STAND — DAY" → "Taco Stand". On any failure to
// parse, fall back to "Scene N".
const TIME_SUFFIX_RE =
  /\s+[-—–]\s+(DAY|NIGHT|MORNING|EVENING|AFTERNOON|DUSK|DAWN|CONTINUOUS|LATER|SAME(?:\s+TIME)?|MOMENTS\s+LATER|FLASHBACK)\s*$/i;
const SLUG_PREFIX_RE =
  /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)\s+/i;

function deriveBeatName(heading: string, idx: number): string {
  if (!heading) return `Scene ${idx + 1}`;
  let s = heading.replace(SLUG_PREFIX_RE, "").replace(TIME_SUFFIX_RE, "").trim();
  if (!s) return `Scene ${idx + 1}`;
  return titleCase(s);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function characterId(): string {
  return `char_${Math.random().toString(36).slice(2, 10)}`;
}

function beatId(): string {
  return `beat_${Math.random().toString(36).slice(2, 10)}`;
}
