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
import { generateImageWithFallback } from "@/lib/imageGenWithFallback";
import { uploadJpegToStorage } from "@/lib/imageStorage";
import { logUsage } from "@/lib/usageLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Painted character portrait template. The base prompt explicitly
// pushes the model away from photorealism toward a digital-painting
// finish so a cast of generated thumbnails reads as illustration, not
// casting headshots. The genre-specific aesthetic line varies the
// lighting/background palette so a thriller project looks different
// from a comedy or romance project, while keeping the painted style
// consistent across all of them. Project tone (free-text from the
// Concept tab) is appended verbatim so user-authored vibes ("dreamy,
// magic-realist", "gritty 70s") leak through.
function buildCharacterPrompt(
  description: string,
  projectGenre?: string,
  projectTone?: string,
): string {
  // Aesthetic line per project genre — phrased in painted-illustration
  // terms (no "DSLR realism", no "casting headshot"). Default is the
  // thriller olive-gray palette.
  const aestheticByGenre: Record<string, string> = {
    comedy:    "warm character illustration, painterly brush texture, gentle daylight key light from upper front-left, soft shadow falloff, muted warm-neutral background, restrained contrast",
    romance:   "soft painted character portrait, golden-hour key light from upper front-left, gentle painterly shadow falloff, muted warm cream background, restrained contrast",
    horror:    "high-contrast moody painted portrait, harsh single-source painterly light from upper front-left, deep shadow falloff, muted near-black background, elevated contrast",
    "sci-fi":  "elevated painted character portrait, cool clean painterly key light from upper front-left, subtle shadow falloff, muted slate-blue background, restrained contrast",
    fantasy:   "painted character portrait with subtle storybook quality, warm directional key light from upper front-left, gentle painterly shadow falloff, muted moss-and-amber background, restrained contrast",
    drama:     "elevated painted character portrait, soft directional key light from upper front-left, gentle painterly shadow falloff, muted warm-neutral background, restrained contrast",
  };
  const fallback = "elevated psychological thriller aesthetic, painterly brush texture, dramatic low-key lighting, soft directional key light from upper front-left, muted dark olive-gray background, restrained contrast";
  const genreKey = (projectGenre || "").toLowerCase();
  const aesthetic = aestheticByGenre[genreKey] || fallback;

  // Optional one-liner appended after the aesthetic line when the
  // user has written project tone notes on the Concept tab. Helps the
  // painting absorb authored vibes the genre alone wouldn't capture.
  const toneLine = (projectTone || "").trim()
    ? `\nProject tone: ${projectTone!.trim()}.`
    : "";

  return `Create a cinematic painted character portrait for a screenplay writing app.

Style: semi-realistic digital painting, subtle oil-painted finish, cinematic character card art, ${aesthetic}, serious neutral expression, premium film character illustration, editorial but not photographic.${toneLine}

Important style direction: This should NOT look like a real photograph. Avoid hyperrealism, avoid photographic skin texture, avoid sharp camera detail, avoid DSLR realism. Skin, hair, and clothing should feel painted with smooth tonal transitions, visible painterly texture, and slightly stylized facial structure.

Crop and framing: vertical portrait crop, 5:6 aspect ratio, head and upper torso visible, face centered, subject facing directly forward, eyes looking into camera, shoulders squared, top of head fully visible, consistent negative space above the head, chest cropped around mid-torso.

Wardrobe: dark understated clothing, cinematic neutrals, minimal styling, no logos, no bright colors unless requested as a small accent.

Background: plain dark textured studio backdrop, muted charcoal and olive tone, soft vignette, no props, no scenery, no text, no border.

Image should feel consistent with a set of painted character thumbnails in a serious thriller project.

Character description:
${description}`;
}

export async function POST(req: Request) {
  const userEmail = req.headers.get("x-user-email");
  if (!isBetaAllowed(userEmail)) {
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
    const { description, genre, tone, projectId } = await req.json();
    if (!description || typeof description !== "string" || !description.trim()) {
      return new Response(JSON.stringify({ error: "description required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = buildCharacterPrompt(
      description.trim(),
      typeof genre === "string" ? genre : undefined,
      typeof tone === "string" ? tone : undefined,
    );
    const isV2 = isV2User(userEmail);

    // Image gen — vertical 4:5 portrait with automatic fallback.
    // gpt-image-2 first for v2 users; dall-e-3 fallback if it fails.
    // dall-e-3's nearest portrait is 1024x1792 (9:16, slightly taller
    // than 4:5 but acceptable; sharp will center-crop).
    const sizes = { gptImage2: "1024x1280" as const, dallE3: "1024x1792" as const };
    const attempt = await generateImageWithFallback({
      apiKey,
      prompt,
      sizes,
      context: "generate-character-image",
      preferV2: isV2,
    });
    if (!attempt.ok) {
      void logUsage({
        userEmail,
        projectId: projectId ?? null,
        provider: "openai",
        kind: "image",
        model: isV2 ? "gpt-image-2" : "dall-e-3",
        action: "generate_character_image",
        image: { count: 1, size: isV2 ? sizes.gptImage2 : sizes.dallE3 },
        error: `${attempt.code ?? "error"}: ${attempt.error}`,
      });
      return new Response(JSON.stringify({
        error: attempt.error,
        code: attempt.code,
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    void logUsage({
      userEmail,
      projectId: projectId ?? null,
      provider: "openai",
      kind: "image",
      model: attempt.model,
      action: "generate_character_image",
      image: {
        count: 1,
        size: attempt.model === "gpt-image-2" ? sizes.gptImage2 : sizes.dallE3,
      },
    });
    const b64 = attempt.b64;

    // Compress: source PNG → 500x600 (5:6) JPEG (~30–60KB). Card
    // displays at 100x120 logical / 200x240 retina, so 500x600 gives
    // plenty of pixel density without bloating storage.
    const pngBuffer = Buffer.from(b64, "base64");
    const jpegBuffer = await sharp(pngBuffer)
      .resize(500, 600, { fit: "cover", position: "attention" })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Upload to the `character-images` Supabase Storage bucket and
    // return its public URL. Falls back to an inline data URL when
    // SUPABASE_SERVICE_ROLE_KEY isn't configured (legacy behavior),
    // so the API contract stays the same: caller treats `thumbnail`
    // as an opaque string and `<img src>` renders either form.
    const { thumbnail } = await uploadJpegToStorage("character-images", jpegBuffer);

    return new Response(JSON.stringify({ thumbnail }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
