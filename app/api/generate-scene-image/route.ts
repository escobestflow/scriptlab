// Generates a cinematic scene thumbnail via gpt-image-2 (v2) /
// dall-e-3 (v1). Style prompt is fixed across the project so beat
// thumbnails in a single story read as a coherent set; per-scene
// variation comes only from the free-text scene description.
//
// Sharp center-crops to 7:5 landscape (700x500) and JPEG-compresses
// before returning. The card displays at 101x72 (7:5) logical /
// 202x144 retina, so 700x500 has plenty of pixel density without
// bloating storage.

import sharp from "sharp";
import { isBetaAllowed, BETA_FORBIDDEN_RESPONSE } from "@/lib/betaAccess";
import { isV2User } from "@/lib/v2Access";
import { generateImageWithFallback } from "@/lib/imageGenWithFallback";
import { uploadJpegToStorage } from "@/lib/imageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildScenePrompt(
  description: string,
  projectGenre?: string,
  projectTone?: string,
): string {
  // Genre-aware visual-tone line. Default is the thriller charcoal /
  // teal palette; other genres warm/cool the palette while keeping
  // the painted finish consistent.
  const toneByGenre: Record<string, string> = {
    comedy:    "warm cinematic concept art, painterly brush texture, soft natural daylight, gentle shadow falloff, muted warm-neutral palette, restrained contrast",
    romance:   "soft cinematic concept art, golden-hour light, painterly shadow falloff, muted warm cream and amber palette, restrained contrast",
    horror:    "high-contrast moody cinematic concept art, harsh single-source light, deep shadow falloff, muted near-black with cold highlights, elevated contrast",
    "sci-fi":  "cool cinematic concept art, painterly brush texture, clean directional light, subtle shadow falloff, muted slate-blue and steel palette, restrained contrast",
    fantasy:   "cinematic concept art with subtle storybook quality, painterly brush texture, warm directional light, muted moss-and-amber palette, restrained contrast",
    drama:     "elevated cinematic concept art, soft directional light, painterly shadow falloff, muted warm-neutral palette, restrained contrast",
  };
  const fallback = "moody cinematic concept art, elevated psychological thriller aesthetic, dark atmospheric lighting, soft film grain, painterly detail, dramatic contrast, restrained color palette of muted charcoal, deep teal, desaturated blue-gray with warm amber highlights only when needed";
  const genreKey = (projectGenre || "").toLowerCase();
  const tone = toneByGenre[genreKey] || fallback;

  // Optional one-liner appended after the visual-tone block when the
  // user has written project-tone notes on the Concept tab.
  const toneLine = (projectTone || "").trim()
    ? `\nProject tone: ${projectTone!.trim()}.`
    : "";

  return `Create a cinematic scene thumbnail for a screenplay writing app.

Style: semi-realistic digital painting, subtle oil-painted finish, ${tone}, premium indie film still, not a photograph.${toneLine}

Visual tone: mysterious, tense, quiet, cinematic, emotionally charged. Avoid bright colors, glossy realism, over-sharpened detail, or clean commercial photography.

Composition: wide landscape frame, 7:5 aspect ratio, single clear focal point, strong depth, cinematic framing, negative space, simple readable silhouette, no text, no logos, no borders. The image should feel like a key moment from a dark feature film.

Lighting: low-key lighting, soft directional light, heavy shadow falloff, atmospheric haze, restrained highlights, realistic but painterly texture.

Rendering: semi-realistic painted film still, not hyperrealistic, not a real photo, not cartoon, not anime. Smooth painterly surfaces, subtle brush texture, cinematic matte finish.

Scene description:
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
    const { description, genre, tone } = await req.json();
    if (!description || typeof description !== "string" || !description.trim()) {
      return new Response(JSON.stringify({ error: "description required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = buildScenePrompt(
      description.trim(),
      typeof genre === "string" ? genre : undefined,
      typeof tone === "string" ? tone : undefined,
    );
    const isV2 = isV2User(req.headers.get("x-user-email"));

    // Image gen — landscape with automatic fallback. gpt-image-2 first
    // for v2 users; dall-e-3 fallback if it fails. dall-e-3's nearest
    // landscape is 1792x1024 (16:9, slightly wider than 7:5 but
    // acceptable; sharp will center-crop to 7:5).
    const attempt = await generateImageWithFallback({
      apiKey,
      prompt,
      sizes: { gptImage2: "1536x1024", dallE3: "1792x1024" },
      context: "generate-scene-image",
      preferV2: isV2,
    });
    if (!attempt.ok) {
      return new Response(JSON.stringify({
        error: attempt.error,
        code: attempt.code,
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const b64 = attempt.b64;

    // Compress: source PNG → 700x500 (7:5) JPEG (~30–60KB). Card
    // displays at 101x72 logical / 202x144 retina, so 700x500 has
    // plenty of pixel density without bloating storage.
    const pngBuffer = Buffer.from(b64, "base64");
    const jpegBuffer = await sharp(pngBuffer)
      .resize(700, 500, { fit: "cover", position: "attention" })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Upload to the `scene-images` Supabase Storage bucket and
    // return its public URL. Falls back to an inline data URL when
    // SUPABASE_SERVICE_ROLE_KEY isn't configured — same contract as
    // /api/generate-character-image.
    const { thumbnail } = await uploadJpegToStorage("scene-images", jpegBuffer);

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
