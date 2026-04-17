// Locked visual-system brief for ScriptLab project thumbnails.
//
// Two-stage pipeline:
//   1. Claude Haiku takes the project inputs (title / logline / genres) and,
//      following the locked rules below, emits a structured brief ending in
//      a "Final Image Prompt:" section.
//   2. That final prompt is extracted and sent to DALL-E 3 verbatim.
//
// The style system is distilled from three reference images and enforces:
//   - cinematic minimalist poster illustration
//   - muted palette with a single bold accent
//   - vertical 3:4 movie-poster composition
//   - flat vector-like rendering (NO grain, NO texture)

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_BRIEF = `You are generating a highly controlled image brief for ScriptLab project thumbnails.

Your goal is to produce a consistent, cinematic, minimalist movie poster image brief that matches a locked visual system.

CRITICAL REQUIREMENT:
The output image MUST be a vertical movie poster (3:4 aspect ratio). Compose for vertical framing, not square.

STEP 1 — UNDERSTAND THE PROJECT
- Read the project title, logline, genre, and tone.
- Identify ONE clear visual subject.
- Do NOT create multi-character or complex narrative scenes.

STEP 2 — SIMPLIFY THE IDEA
- Reduce the concept to ONE iconic visual.
- Feel like a movie poster, not a scene.
- Optionally include ONE symbolic object only if it strengthens clarity.

STEP 3 — DEFINE COMPOSITION
Choose ONE of:
- centered portrait
- side profile
- symbolic object

Composition rules:
- single dominant focal subject
- strong vertical composition (top-to-bottom hierarchy)
- clear silhouette readable at thumbnail size
- minimal background detail
- balanced, iconic layout
- NOT a full environment or detailed setting
- must feel like a professionally designed movie poster

STEP 4 — LOCKED STYLE SYSTEM

Style:
- cinematic minimalist film poster illustration
- stylized realism with simplified forms
- clean, flat rendering (NO texture, NO grain, NO stippling, NO paper texture, NO rough edges)
- smooth vector-like shapes with subtle gradients only where needed (sky, lighting)
- strong silhouette hierarchy with natural proportions
- composition-driven, not character-detail focused

Color palette (STRICT):
- muted cinematic tones (dusty teal, sage, warm beige, soft sky colors)
- ONE bold accent color used sparingly (sun red, burnt orange, coral)
- strong contrast between subject and background
- limited palette, no excessive color variation

Lighting & Shading:
- soft cinematic lighting (sunset, dusk, directional light)
- minimal gradients only for atmosphere (sky, light falloff)
- clean shadows, NO texture, NO noise

Composition:
- vertical movie poster composition (3:4 ratio)
- one clear focal subject
- simple, iconic layout
- large environmental shapes (sun, sky, horizon, architecture)
- foreground / midground / background separation
- designed to read clearly at thumbnail size

Tone:
- cinematic, atmospheric, slightly nostalgic, clean, modern, premium

STEP 5 — AVOID COMPLETELY
photorealism, 3D rendering, glossy lighting, painterly brushwork, comic book style, anime style, childish illustration, corporate flat illustration, busy scenes, detailed environments, perspective-heavy compositions, clutter, neon or overly saturated colors, text, words, letters, logos, grain, noise, texture, stippling, paper texture, rough edges.

STEP 6 — OUTPUT FORMAT (STRICT)

Return ONLY the following, in this exact shape:

Subject:
[short subject description]

Composition:
[clear composition type and vertical framing]

Mood:
[emotional tone]

Visual Symbol:
[one symbolic object, or "none"]

Final Image Prompt:
[a single paragraph, ready to send to an image model verbatim. It MUST:
- describe the subject and composition concretely
- specify vertical 3:4 movie poster framing
- bake in the locked palette (muted cinematic tones + one bold accent)
- bake in flat, clean, vector-like rendering with no texture or grain
- explicitly exclude: photorealism, 3D, text/letters, grain, texture, noise, neon colors, anime, comic-book]`;

export interface ImagePromptInputs {
  title: string;
  logline?: string;
  genres?: string[];
  // Free-form user additions — folded into the brief as soft guidance.
  // The locked style rules still take precedence.
  extra?: string;
}

// Extracts the block after "Final Image Prompt:" up to the end of the reply.
// Falls back to the full response if the heading is missing.
function extractFinalPrompt(raw: string): string {
  const match = raw.match(/Final Image Prompt:\s*([\s\S]+)$/i);
  if (!match) return raw.trim();
  return match[1].trim();
}

export async function buildImagePrompt(
  inputs: ImagePromptInputs,
  apiKey: string,
): Promise<string> {
  const { title, logline, genres, extra } = inputs;
  const genreStr = genres?.length ? genres.join(", ") : "drama";
  const extraTrim = (extra || "").trim();

  const userMessage = [
    `Project title: ${title || "Untitled"}`,
    `Logline: ${logline || "(no logline provided — infer from title and genre)"}`,
    `Genre: ${genreStr}`,
    ...(extraTrim
      ? [
          ``,
          `User's custom additions (incorporate where they fit without breaking the locked style system — palette, flat vector rendering, no grain/text, 3:4 vertical framing are non-negotiable):`,
          extraTrim,
        ]
      : []),
    ``,
    `Follow the brief. Return ONLY the six labeled sections.`,
  ].join("\n");

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 800,
    system: SYSTEM_BRIEF,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlocks = res.content.filter(b => b.type === "text");
  const raw = textBlocks.map(b => (b as { text: string }).text).join("\n");
  return extractFinalPrompt(raw);
}
