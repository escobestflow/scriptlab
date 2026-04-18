// Preset TTS style instructions derived from project type + primary genre.
// Baked-in; user never sees or edits. These shape how gpt-4o-mini-tts
// performs a line: pacing, pitch range, emotional commitment, cadence.
//
// Design rule of thumb: prioritize *engaged, expressive, natural pace*.
// Slow + measured instructions → monotone + sluggish. Avoid them.

import type { Genre, ProjectType } from "./story";

// Shared baseline every instruction inherits. Forbids the two failure modes
// we observed in practice: too-slow playback and too-flat delivery.
//
// Pacing is enforced via these instructions (the `speed` request param is
// no longer sent — see /api/tts/route.ts).
const BASE_DIALOGUE =
  "Perform this line like an engaged actor, not a narrator. " +
  "Slightly brisk conversational pace — faster than default, never sluggish, never rushed. " +
  "Use full pitch range and inflection; absolutely not monotone. " +
  "Commit to the emotion.";

const BASE_NARRATOR =
  "Read like a cinematic film-trailer narrator with life in the voice. " +
  "Slightly brisk forward pace — faster than default, clear cadence, moderately expressive. " +
  "Dynamic pitch; never flat, never ponderous.";

const GENRE_FLAVOR: Record<Genre, string> = {
  thriller: "Controlled intensity, clipped cadence on tense beats.",
  horror: "Restrained menace, quiet dread — not shouted.",
  drama: "Grounded emotional commitment; real, felt.",
  comedy: "Warm playful energy, snappy comic timing, smile in the voice.",
  action: "Crisp forward momentum, high energy without shouting.",
  romance: "Tender intimate warmth; soft dynamics on close beats.",
  "sci-fi": "Curious, wondrous, slightly awed.",
  mystery: "Hushed inviting curiosity; quiet intensity.",
};

function projectTag(projectType: ProjectType | undefined): string {
  if (projectType === "tv-show") return " Episodic TV delivery.";
  if (projectType === "short") return " Short-film economy.";
  return " Feature-film naturalism.";
}

export function getStyleForProject(
  projectType: ProjectType | undefined,
  genres: Genre[] | undefined,
): string {
  const primary = (genres && genres[0]) || "drama";
  return BASE_DIALOGUE + " " + GENRE_FLAVOR[primary] + projectTag(projectType);
}

export function getNarratorStyle(
  projectType: ProjectType | undefined,
  genres: Genre[] | undefined,
): string {
  const primary = (genres && genres[0]) || "drama";
  return BASE_NARRATOR + " " + GENRE_FLAVOR[primary] + projectTag(projectType);
}

// Kept for callsites but no longer sent to the OpenAI API (pacing lives
// in the instructions above). Left here so future maintainers can re-enable
// it without threading a new param through the whole chain.
export const DEFAULT_TTS_SPEED = 1.0;
