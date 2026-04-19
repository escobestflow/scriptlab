// Fountain serializer — Story → plaintext `.fountain` file.
//
// Fountain (fountain.io) is the de-facto plaintext format for
// screenplays. Screenwriter software (Final Draft, WriterDuet,
// Highland, Slugline, Logline) all import it natively, which is why
// we ship it alongside the rich HTML email body: the HTML is for
// reading, the Fountain file is for working.
//
// Our Story model stores each Scene as a free-form `heading` string
// plus a `content` block (usually already-screenplay-shaped prose
// emitted by the LLM). We don't parse `content` — we emit it
// verbatim — but we do defensively format the `heading` so it
// round-trips cleanly:
//
//   - "INT. KITCHEN - DAY"    → passes through (valid slug)
//   - "Kitchen, day"          → prefixed with "." to force it to
//                               parse as a scene heading in strict
//                               Fountain parsers
//   - ""                      → emit a blank forced heading "."
//                               so the scene still renders as a
//                               scene break rather than silent prose.
//
// Title-page metadata is emitted in the "Key: Value" block Fountain
// defines at the top of the file (https://fountain.io/syntax#title).

import type { Story } from "./story";
import {
  getActiveConceptDraft,
  getActiveStoryLayerDraft,
  getActiveScriptDraft,
} from "./story";

// Regex for a "real" Fountain slug line. Fountain spec: a scene heading
// starts with INT, EXT, EST, INT./EXT, or INT/EXT (with optional period,
// space, and location). Anything else we force with a leading ".".
const SLUG_PREFIX_RE = /^(?:int\.?|ext\.?|est\.?|int\.?\/ext\.?|i\/e)\b/i;

function normalizeHeading(raw: string): string {
  const h = raw.trim();
  if (!h) return ".";                 // forced-empty slug; keeps scene break
  if (SLUG_PREFIX_RE.test(h)) return h.toUpperCase();
  // Not a valid slug — force it with a leading dot per Fountain spec.
  return `.${h}`;
}

// Normalize line endings + trim trailing whitespace per line. Fountain
// is LF-oriented; CRLF confuses some parsers.
function cleanBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(l => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

export function serializeFountain(story: Story): string {
  const concept = getActiveConceptDraft(story);
  const scriptDraft = getActiveScriptDraft(story);
  const storyDraft = getActiveStoryLayerDraft(story);
  // ScriptLayerDraft nests scenes under .script.scenes (see lib/story.ts)
  const scenes = scriptDraft.script?.scenes ?? [];

  // ── Title page ──
  const titleLines: string[] = [];
  titleLines.push(`Title: ${story.title || "Untitled"}`);
  // Credit/Author are optional; include a generic credit line so the
  // title page isn't bare when opened in Final Draft.
  titleLines.push("Credit: Written by");
  if (concept.logline?.trim()) {
    // Fountain supports arbitrary keys; Logline is widely recognized.
    titleLines.push(`Logline: ${concept.logline.trim()}`);
  }
  if (concept.settings?.genres?.length) {
    titleLines.push(`Genre: ${concept.settings.genres.join(", ")}`);
  }
  titleLines.push(`Draft date: ${new Date().toISOString().slice(0, 10)}`);

  // Blank line separates title page from body per spec.
  const parts: string[] = [titleLines.join("\n"), ""];

  // ── Body ──
  if (scenes.length === 0) {
    // Emit a single synthetic "no scenes yet" slug so the file is
    // always valid and communicates the current project state.
    parts.push(".NO SCENES YET");
    parts.push("");
    parts.push(
      "[[ This project has no Script draft content. The Concept, " +
      "Characters, and Story beats are included as separate sections " +
      "in the email bundle. ]]",
    );
    parts.push("");
  } else {
    parts.push("FADE IN:");
    parts.push("");
    for (const scene of scenes) {
      parts.push(normalizeHeading(scene.heading));
      parts.push("");
      const body = cleanBody(scene.content ?? "");
      if (body) parts.push(body);
      if (scene.notes?.trim()) {
        // Fountain boneyard / notes: [[ ... ]] is inline notes. Use
        // block form so they don't disrupt dialogue alignment.
        parts.push("");
        parts.push(`[[ NOTES: ${scene.notes.trim().replace(/\]\]/g, "] ]")} ]]`);
      }
      parts.push("");
    }
    parts.push("FADE OUT.");
    parts.push("");
  }

  // ── Appendix: beats + characters as Fountain notes ──
  // We keep these out of the script body (they're not scenes) but
  // include them as a boneyard block at the end so the .fountain
  // file is a complete project snapshot, not just the prose.
  const beats = storyDraft.beats ?? [];
  if (beats.length > 0) {
    parts.push("/*");
    parts.push("BEAT OUTLINE");
    parts.push("");
    for (const b of beats) {
      parts.push(`${b.position + 1}. ${b.name || "(untitled beat)"}`);
      if (b.summary?.trim()) parts.push(`   ${b.summary.trim()}`);
      if (b.purpose?.trim()) parts.push(`   Purpose: ${b.purpose.trim()}`);
    }
    parts.push("*/");
    parts.push("");
  }

  return parts.join("\n");
}
