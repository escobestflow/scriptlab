// Preset TTS style instructions derived from project type + primary genre.
// Baked-in; user never sees or edits. These shape how gpt-4o-mini-tts
// performs a line: pacing, pitch range, emotional commitment, cadence.
//
// Design rule of thumb: prioritize *engaged, expressive, natural pace*.
// Slow + measured instructions → monotone + sluggish. Avoid them.

import type { Genre, ProjectType } from "./story";

// Shared baseline every instruction inherits. Forbids the two failure modes
// we observed in practice: too-slow playback and too-flat delivery.
const BASE_DIALOGUE =
  "Perform this line like an engaged actor, not a narrator. " +
  "Natural conversational pace — never slow, never rushed. " +
  "Use full pitch range and inflection; absolutely not monotone. " +
  "Commit to the emotion.";

const BASE_NARRATOR =
  "Read like a cinematic film-trailer narrator with life in the voice. " +
  "Natural forward pace, clear cadence, moderately expressive. " +
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

// Tunable playback speed. gpt-4o-mini-tts accepts `speed` in [0.25, 4.0].
// 1.0 was the default and felt sluggish — 1.1 is slightly quicker without
// sounding sped-up. Expose it so we can tune from one place.
export const DEFAULT_TTS_SPEED = 1.1;
