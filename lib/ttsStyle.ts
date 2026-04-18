// Preset TTS style instructions derived from project type + primary genre.
// These are baked-in — the user never sees or edits them. They shape how
// gpt-4o-mini-tts delivers the line (pacing, register, warmth, restraint, etc.).

import type { Genre, ProjectType } from "./story";

const GENRE_STYLE: Record<Genre, string> = {
  thriller:
    "Tense, grounded, and deliberate. Low register. Unhurried. Let silence do work between lines.",
  horror:
    "Measured and quietly unsettling. Withhold intensity — suggest dread rather than shout it.",
  drama:
    "Grounded, intimate, and unhurried. Let weight sit on the important words.",
  comedy:
    "Warm and lightly playful. Natural conversational rhythm. Never oversell the joke.",
  action:
    "Confident and forward-moving. Crisp consonants. Propulsive but never rushed.",
  romance:
    "Soft, close-mic intimacy. Warm, slightly breathy on the tender beats.",
  "sci-fi":
    "Curious, measured, faintly wondrous. Clean and cinematic.",
  mystery:
    "Hushed and observant, always a half-step behind the listener. Invite, don't push.",
};

function projectTag(projectType: ProjectType | undefined): string {
  if (projectType === "tv-show") return " Episodic TV pacing.";
  if (projectType === "short") return " Short-film brevity — every beat matters.";
  return " Feature-film cadence.";
}

export function getStyleForProject(
  projectType: ProjectType | undefined,
  genres: Genre[] | undefined,
): string {
  const primary = (genres && genres[0]) || "drama";
  return GENRE_STYLE[primary] + projectTag(projectType);
}

// Slightly different tilt for scene headings / action lines — a cinematic narrator
// reading stage directions, not a character speaking lines.
export function getNarratorStyle(
  projectType: ProjectType | undefined,
  genres: Genre[] | undefined,
): string {
  return (
    "Cinematic voiceover. Grounded, observational narrator. " +
    getStyleForProject(projectType, genres)
  );
}
