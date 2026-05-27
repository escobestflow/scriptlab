// Hardcoded project-cover overrides. Some demo / showcase projects
// ship with a hand-picked static image instead of the auto-generated
// one — keep that asset pinned regardless of what (if anything) is
// stored on `story.thumbnail`. Title match is case-insensitive on
// trimmed input so "buck mark", "Buck Mark", and " Buck Mark " all
// resolve the same way.

import type { Story } from "./story";

const STATIC_THUMBNAILS: Record<string, string> = {
  "buck mark": "/v2/buckmark-project-image.png",
};

function normalizedTitle(story: Pick<Story, "title">): string {
  return (story.title ?? "").trim().toLowerCase();
}

/** Returns the static-asset path when a project's title matches one of
 *  our hardcoded overrides, otherwise `undefined`. Callers should
 *  prefer this over reading `story.thumbnail` directly so the override
 *  wins everywhere the cover is rendered. */
export function getStaticProjectThumbnail(story: Pick<Story, "title">): string | undefined {
  return STATIC_THUMBNAILS[normalizedTitle(story)];
}

/** Resolves the project's effective cover image. Static overrides take
 *  precedence over the stored `story.thumbnail`. Returns `undefined`
 *  when neither is set — render the initial-letter placeholder in that
 *  case (matches the existing fallback UX). */
export function getEffectiveProjectThumbnail(
  story: Pick<Story, "title" | "thumbnail">,
): string | undefined {
  return getStaticProjectThumbnail(story) ?? story.thumbnail;
}

/** True iff `generateThumbnail` should fire for this project. Skipped
 *  when there's a static override (the static asset is the canonical
 *  cover for those titles — we never want to call the OpenAI API or
 *  overwrite the static reference with a generated one). */
export function shouldGenerateProjectThumbnail(
  story: Pick<Story, "title" | "thumbnail">,
): boolean {
  return getStaticProjectThumbnail(story) === undefined;
}
