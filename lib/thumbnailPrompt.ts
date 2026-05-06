// Project-cover image-prompt builder.
//
// Two-stage pipeline:
//   1. Claude Haiku takes the project inputs (title / logline / genres /
//      free-text extras) and fills in the [SUBJECT] block of the
//      cinematic-film-still template below.
//   2. The fully-rendered prompt is sent to the image model verbatim
//      (gpt-image-2 for v2 users, dall-e-3 for v1).
//
// Style brief is locked at the template level — every project ends up
// with the same elevated, moody, editorial film-poster look. Genre and
// concept only flex the SUBJECT description, never the visual system.

import Anthropic from "@anthropic-ai/sdk";

// The image-model prompt template. [SUBJECT] is the only swappable
// region — Haiku fills it with 2–4 sentences keyed to the project.
const PROMPT_TEMPLATE = `Create a cinematic project cover image for a screenplay app.

Style: elevated film poster still, moody cinematic realism, editorial composition, premium indie film key art, subtle surrealism, painterly photorealistic detail, soft grain, shallow depth of field, dramatic but restrained lighting, muted sophisticated color palette, strong atmosphere, minimal visual clutter.

Composition: one clear focal subject or location, simple background, emotionally mysterious, enough negative space for UI text overlay near the lower left, no text in the image, no logos, no typography, no borders. Wide cinematic landscape framing, approximately 2:1 aspect ratio.

Lighting: soft directional light, deep shadows, atmospheric haze, natural contrast, elegant highlights.

Color: muted neutrals with one restrained accent color if useful, cinematic teal/amber/charcoal/cream tones, not overly saturated.

Subject:
[SUBJECT]`;

const SYSTEM_BRIEF = `You translate a screenplay project's metadata (title, logline, genres) into a single image-generation prompt for an editorial cinematic-film-still cover.

You receive the project context. Your job is to fill in the [SUBJECT] block of a fixed cinematic-still template — everything else in the template is locked and will be sent verbatim to the image model.

RULES FOR FILLING IN [SUBJECT]:
- Describe ONE iconic subject, location, or moment that the cover image will depict — not multiple disjoint scenes.
- 2 to 4 sentences. Concrete and visually specific (e.g. "a lone figure on a dimly lit hotel balcony at dusk, smoke curling from a forgotten cigarette in their hand"), not abstract themes (e.g. NOT "the weight of regret").
- Match the genre's mood without illustrating literal plot events.
- Lean into a wide cinematic landscape composition — the image is rendered at ~2:1, so describe environments and framings that suit horizontal letterbox shots, not vertical portraits.
- Negative space at lower-left is reserved for UI text — describe the subject so the lower-left third can sit darker / quieter.
- DO NOT describe text, words, captions, signs, or typography appearing in the image. The template already prohibits them — don't reintroduce them.
- DO NOT describe faces in fine detail (no specific skin/eye/hair colors, no named likenesses) — keep human subjects atmospheric and slightly anonymous.
- Leave room for interpretation. The image should feel emotionally mysterious, not a literal scene illustration.

OUTPUT FORMAT (STRICT):
Return EXACTLY the filled-in template — every line of the locked template followed by your [SUBJECT] paragraph. No labels around your output, no commentary, no markdown formatting, no quotation marks. The first line of your reply must be: "Create a cinematic project cover image for a screenplay app."`;

export interface ImagePromptInputs {
  title: string;
  logline?: string;
  genres?: string[];
  // Free-form user additions — folded into the brief as soft guidance.
  // The locked style rules still take precedence.
  extra?: string;
}

// Defensive extraction: the system prompt asks Haiku to return ONLY
// the filled template starting with the locked first line. If the
// model still wraps with prose, slice from that line forward. If we
// can't find it, return the raw response and let the image model
// figure it out.
function extractFilledPrompt(raw: string): string {
  const idx = raw.indexOf("Create a cinematic project cover image");
  if (idx < 0) return raw.trim();
  return raw.slice(idx).trim();
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
    ``,
    `LOCKED TEMPLATE — return this verbatim with [SUBJECT] replaced:`,
    `"""`,
    PROMPT_TEMPLATE,
    `"""`,
    ...(extraTrim
      ? [
          ``,
          `User's free-text steering — incorporate into the [SUBJECT] block where it fits, but the locked template (style/composition/lighting/color rules) is non-negotiable:`,
          extraTrim,
        ]
      : []),
    ``,
    `Return only the filled template, starting with "Create a cinematic project cover image for a screenplay app."`,
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
  return extractFilledPrompt(raw);
}
