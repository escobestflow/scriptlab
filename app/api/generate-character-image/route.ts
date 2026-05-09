// Generates a cinematic character portrait via gpt-image-2 (v2) /
// dall-e-3 (v1). Style prompt is fixed across the project so portraits
// in a single cast read as a coherent set; per-character variation
// comes only from the free-text description spliced into the
// [INSERT CHARACTER DESCRIPTION HERE] slot.
//
// Sharp center-crops to 4:5 vertical (480x600) and JPEG-compresses
// before returning. The resulting data URL is small enough to store
// inline on Character.thumbnail without bloating localStorage.

import sharp from "sharp";
import { isBetaAllowed, BETA_FORBIDDEN_RESPONSE } from "@/lib/betaAccess";
import { isV2User } from "@/lib/v2Access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fixed style template. The mid-section is interchangeable with
// project-genre tone if we want stylistic drift across projects later
// (e.g. "comedy" → brighter lighting); for now the same template is
// applied per-project so portraits stay visually consistent.
function buildCharacterPrompt(description: string, projectGenre?: string): string {
  // Optional genre flavor — adjusts the lighting/tone phrase if the
  // project genre suggests something other than thriller. Conservative
  // for now: only override for explicitly non-thriller genres.
  const aestheticByGenre: Record<string, string> = {
    comedy: "warm casting headshot, naturalistic daylight, gentle key light from upper front-left, soft shadow falloff, muted warm-neutral background, restrained contrast",
    romance: "soft cinematic headshot, golden-hour key light from upper front-left, gentle shadow falloff, muted warm cream background, restrained contrast",
    horror: "high-contrast moody headshot, harsh single-source light from upper front-left, deep shadow falloff, muted near-black background, elevated contrast",
    "sci-fi": "elevated cinematic headshot, cool clean key light from upper front-left, subtle shadow falloff, muted slate-blue background, restrained contrast",
  };
  const fallback = "elevated psychological thriller aesthetic, painterly photorealistic detail, dramatic low-key lighting, soft directional key light from upper front-left, subtle shadow falloff, muted dark olive-gray background, restrained contrast";
  const genreKey = (projectGenre || "").toLowerCase();
  const aesthetic = aestheticByGenre[genreKey] || fallback;

  return `Create a cinematic character portrait for a screenplay writing app.

Style: moody studio headshot, ${aesthetic}, realistic skin texture, serious neutral expression, premium film casting portrait, editorial but not glamorous.

Crop and framing: vertical portrait crop, 4:5 aspect ratio, head and upper torso visible, face centered, subject facing directly forward, eyes looking into camera, shoulders squared, top of head fully visible, no extreme close-up, no full body, consistent negative space above the head, chest cropped around mid-torso.

Wardrobe: dark understated clothing, cinematic neutrals, minimal styling, no logos, no bright colors unless specifically requested as a small accent.

Background: plain dark textured studio backdrop, muted charcoal/olive tone, no props, no scenery, no text, no border.

Image should feel consistent with a set of character thumbnails in a serious thriller project.

Character description:
${description}`;
}

export async function POST(req: Request) {
  if (!isBetaAllowed(req.headers.get("x-user-email"))) {
    return Response.json(BETA_FORBIDDEN_RESPONSE.body, {
      status: BETA_FORBIDDEN_RESPONSE.status,
    });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { description, genre } = await req.json();
    if (!description || typeof description !== "string" || !description.trim()) {
      return new Response(JSON.stringify({ error: "description required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = buildCharacterPrompt(description.trim(), typeof genre === "string" ? genre : undefined);
    const isV2 = isV2User(req.headers.get("x-user-email"));

    // Image gen — vertical 4:5 portrait. gpt-image-2 supports custom
    // sizes; dall-e-3's nearest portrait is 1024x1792 (9:16, slightly
    // taller than 4:5 but acceptable; sharp will center-crop).
    const imageBody = isV2
      ? {
          model: "gpt-image-2",
          prompt,
          n: 1,
          size: "1024x1280",  // 4:5 vertical, edges %16, valid for gpt-image-2
          quality: "high",
        }
      : {
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1792",
          response_format: "b64_json",
          quality: "standard",
        };

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(imageBody),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `Image generation error (${imageBody.model}): ${err}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      return new Response(JSON.stringify({ error: "No image returned" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Compress: source PNG → 480x600 (4:5) JPEG (~30–60KB). Card
    // displays at ~64x80 logical / ~128x160 retina, so 480x600 has
    // plenty of pixel density without bloating storage.
    const pngBuffer = Buffer.from(b64, "base64");
    const jpegBuffer = await sharp(pngBuffer)
      .resize(480, 600, { fit: "cover", position: "attention" })
      .jpeg({ quality: 80 })
      .toBuffer();

    const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;

    return new Response(JSON.stringify({ thumbnail: dataUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
