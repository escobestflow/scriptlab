// Parses a screenplay plain-text blob into a sequence of TTS-ready chunks.
// Handles the standard screenplay format:
//
//   INT. LOCATION - DAY             ← scene heading
//
//   Action/description paragraph.   ← action
//
//                   ALICE           ← character cue (ALL CAPS, possibly "(CONT'D)")
//              (whispering)         ← parenthetical
//      Dialogue goes here.          ← dialogue
//
// Parentheticals are parsed but excluded from playback by default —
// they're acting directions, not lines to speak aloud.

export type ChunkKind = "heading" | "action" | "dialogue" | "parenthetical";

export interface ScriptChunk {
  kind: ChunkKind;
  /** Character speaking this dialogue/parenthetical; undefined for heading/action. */
  character?: string;
  text: string;
}

const SCENE_HEADING_RE = /^(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.)/i;
// ALL-CAPS (plus digits, spaces, apostrophes, hyphens, #, dots, and optional parens)
// Cue lines never contain lowercase letters outside parens.
const CHARACTER_CUE_RE = /^[A-Z][A-Z0-9 .'#-]*(\s*\(.*\))?\s*$/;

export function parseScreenplay(raw: string): ScriptChunk[] {
  if (!raw) return [];
  const lines = raw.replace(/\r/g, "").split("\n");
  const chunks: ScriptChunk[] = [];
  const actionBuf: string[] = [];

  const flushAction = () => {
    if (!actionBuf.length) return;
    const text = actionBuf.join(" ").trim();
    actionBuf.length = 0;
    if (text) chunks.push({ kind: "action", text });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushAction();
      i++;
      continue;
    }

    if (SCENE_HEADING_RE.test(trimmed)) {
      flushAction();
      chunks.push({ kind: "heading", text: trimmed });
      i++;
      continue;
    }

    // Character cue requires:
    //   - all-caps formatting (short line)
    //   - previous line blank OR first line
    //   - followed by at least one non-blank line (the dialogue / parenthetical)
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const nextNonBlank = i + 1 < lines.length && !!lines[i + 1].trim();
    if (
      prevBlank &&
      nextNonBlank &&
      trimmed.length <= 50 &&
      CHARACTER_CUE_RE.test(trimmed)
    ) {
      flushAction();
      const name = trimmed.replace(/\s*\(.*\)\s*$/, "").trim();
      i++;
      const dialogueBuf: string[] = [];
      while (i < lines.length) {
        const dt = lines[i].trim();
        if (!dt) break;
        if (dt.startsWith("(") && dt.endsWith(")")) {
          if (dialogueBuf.length) {
            chunks.push({
              kind: "dialogue",
              character: name,
              text: dialogueBuf.join(" ").trim(),
            });
            dialogueBuf.length = 0;
          }
          chunks.push({
            kind: "parenthetical",
            character: name,
            text: dt.replace(/^\(|\)$/g, "").trim(),
          });
        } else {
          dialogueBuf.push(dt);
        }
        i++;
      }
      if (dialogueBuf.length) {
        chunks.push({
          kind: "dialogue",
          character: name,
          text: dialogueBuf.join(" ").trim(),
        });
      }
      continue;
    }

    actionBuf.push(trimmed);
    i++;
  }
  flushAction();
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

// Deterministic so the same character always reads in the same voice.
// `hint` is the Characters-layer `voice` field (e.g. "gruff tenor, 40s").
export function assignCharacterVoice(name: string, hint?: string): TtsVoice {
  const h = (hint || "").toLowerCase();
  if (MASCULINE_RE.test(h)) return pickFrom(name, ["echo", "fable"]);
  if (FEMININE_RE.test(h)) return pickFrom(name, ["nova", "shimmer"]);
  return pickFrom(name, CHARACTER_VOICES);
}
