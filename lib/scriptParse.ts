// Parses a screenplay-style blob into a sequence of TTS-ready chunks.
//
// The app's scene generator produces "screenplay-adjacent" prose, which in
// practice means one of these per paragraph (blank-line separated):
//
//   INT. TACO STAND — DAY                        ← scene heading
//   Action paragraph, sometimes multi-line.      ← action
//   NORA: I've broken it into phases.            ← dialogue (inline cue)
//   NORA                                         ← dialogue (standalone cue,
//     (whispering)                                 spec format — kept as a
//     I've broken it into phases.                  fallback)
//
// We also accept `Nora:` (Title Case colon) as a softer fallback since LLMs
// sometimes drop caps. Parentheticals are parsed but skipped in playback —
// they're acting directions, not lines to speak.

export type ChunkKind = "heading" | "action" | "dialogue" | "parenthetical";

export interface ScriptChunk {
  kind: ChunkKind;
  /** Character speaking this dialogue/parenthetical; undefined for heading/action. */
  character?: string;
  text: string;
}

const SCENE_HEADING_RE = /^(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.)/i;

// Inline "NAME: dialogue" — NAME is ALL-CAPS letters + digits/spaces/punct,
// 2–40 chars, followed by ':' and some text. This is the dominant format
// from the scene generator (see sampleData.ts for reference).
const INLINE_CUE_RE = /^([A-Z][A-Z0-9 .'#\-]{1,39}?)\s*:\s*([\s\S]+)$/;

// Softer fallback: "Title Case Name: dialogue" or "Name: dialogue".
// Requires capitalized first letter and a colon separator.
const SOFT_INLINE_CUE_RE = /^([A-Z][A-Za-z0-9 .'#\-]{1,39}?)\s*:\s*([\s\S]+)$/;

// Standalone cue line (spec format): ALL-CAPS name on its own line,
// optional (CONT'D) / (V.O.) / (O.S.) suffix.
const STANDALONE_CUE_RE = /^[A-Z][A-Z0-9 .'#\-]{0,48}(\s*\([^)]+\))?\s*$/;

function stripActing(text: string): string {
  // Drop a leading parenthetical direction like "(whispering) I meant it."
  return text.replace(/^\(([^)]*)\)\s*/u, "").trim();
}

function normalize(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

// Strip markdown emphasis around a name so "**MADISON**: hey" or
// "*Madison*: hey" still parses as a cue.
function stripInlineMd(s: string): string {
  return s.replace(/\*\*|__|\*/g, "").replace(/`/g, "").trim();
}

// Matches "NAME (CONT'D): dialogue" or "NAME: dialogue" with optional
// parenthetical suffix inside the cue half.
const INLINE_CUE_WITH_PARENS_RE =
  /^([A-Z][A-Z0-9 .'#\-]{1,39}?)(?:\s*\([^)]{0,30}\))?\s*:\s*([\s\S]+)$/;

export function parseScreenplay(raw: string): ScriptChunk[] {
  if (!raw) return [];
  const blocks = raw
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean);

  const chunks: ScriptChunk[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const rawBlock = blocks[bi];
    // Always strip markdown first so regexes see clean text.
    const block = stripInlineMd(rawBlock);

    // Priority 0: a block that is a single ALL-CAPS line — a standalone
    // cue like "**MADISON**" — and whose following block is non-heading
    // prose. Treat as cue + dialogue pair, consume both blocks.
    // NOTE: must skip scene headings ("INT. ROOM - DAY") because they
    // also look like single-line all-caps text and would otherwise be
    // swallowed as a character named "INT. ROOM - DAY".
    const blockLines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (
      blockLines.length === 1 &&
      blockLines[0].length <= 50 &&
      STANDALONE_CUE_RE.test(blockLines[0]) &&
      !SCENE_HEADING_RE.test(blockLines[0]) &&
      bi + 1 < blocks.length
    ) {
      const nextClean = stripInlineMd(blocks[bi + 1]);
      if (!SCENE_HEADING_RE.test(nextClean)) {
        const name = blockLines[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
        const dialogueLines = nextClean
          .split("\n")
          .map(l => l.trim())
          .filter(Boolean)
          .filter(l => !(l.startsWith("(") && l.endsWith(")"))); // drop parentheticals
        const text = dialogueLines.join(" ").trim();
        if (text) {
          chunks.push({ kind: "dialogue", character: name, text: normalize(text) });
          bi++; // consume the next block
          continue;
        }
      }
    }

    // 1. Scene heading
    if (SCENE_HEADING_RE.test(block)) {
      chunks.push({ kind: "heading", text: normalize(block) });
      continue;
    }

    // 2. Inline "NAME: dialogue" (with optional parenthetical suffix).
    //    Try strictest form first, then softer fallbacks.
    const inline =
      block.match(INLINE_CUE_WITH_PARENS_RE) ||
      block.match(INLINE_CUE_RE) ||
      (block.length > 20 ? block.match(SOFT_INLINE_CUE_RE) : null);
    if (inline) {
      const rawName = inline[1].trim();
      if (rawName.split(/\s+/).length <= 4) {
        const name = rawName.replace(/\s*\([^)]*\)\s*$/, "").trim();
        const text = stripActing(inline[2].trim());
        if (text) {
          chunks.push({ kind: "dialogue", character: name, text: normalize(text) });
          continue;
        }
      }
    }

    // 3. Standalone cue format: first line is cue, rest is dialogue
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (
      lines.length >= 2 &&
      lines[0].length <= 50 &&
      STANDALONE_CUE_RE.test(lines[0])
    ) {
      const name = lines[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
      const body: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.startsWith("(") && l.endsWith(")")) continue;
        body.push(l);
      }
      const text = body.join(" ").trim();
      if (text) {
        chunks.push({ kind: "dialogue", character: name, text: normalize(text) });
        continue;
      }
    }

    // 4. Otherwise action/description
    chunks.push({ kind: "action", text: normalize(block) });
  }

  return chunks;
}

// ── Voice assignment ──

const CHARACTER_VOICES = ["echo", "fable", "nova", "shimmer", "alloy"] as const;
export type TtsVoice = (typeof CHARACTER_VOICES)[number] | "onyx";

const MASCULINE_RE =
  /\b(he|him|his|male|masculine|man|boy|guy|gruff|baritone|bass|tenor)\b/;
const FEMININE_RE =
  /\b(she|her|hers|female|feminine|woman|girl|soprano|alto|mezzo)\b/;

function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h * 31 + name.charCodeAt(i)) | 0) >>> 0;
  return h;
}

function pickFrom(name: string, pool: readonly string[]): TtsVoice {
  return pool[hash(name) % pool.length] as TtsVoice;
}

// Deterministic: the same character always reads in the same voice.
// `hint` is the Characters-layer `voice` field (e.g. "gruff tenor, 40s").
export function assignCharacterVoice(name: string, hint?: string): TtsVoice {
  const h = (hint || "").toLowerCase();
  if (MASCULINE_RE.test(h)) return pickFrom(name, ["echo", "fable"]);
  if (FEMININE_RE.test(h)) return pickFrom(name, ["nova", "shimmer"]);
  return pickFrom(name, CHARACTER_VOICES);
}
