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
import { logUsage } from "@/lib/usageLog";
import { markBeatAttempted, setBeatThumbnail } from "@/lib/projectImagePersist";

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
    const { description, genre, tone, projectId, beatId, projectName, targetName, draftId, draftLabel } = await req.json();
    if (!description || typeof description !== "string" || !description.trim()) {
      return new Response(JSON.stringify({ error: "description required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Mark imageGenAttempted=true on the beat in Supabase BEFORE the
    // OpenAI call. Same credit-bleed fix as the character route — see
    // generate-character-image/route.ts for the full rationale.
    // AWAIT on Vercel serverless so the write completes before the
    // response shuts the function down.
    if (projectId && beatId) {
      await markBeatAttempted(projectId, beatId);
    }

    const prompt = buildScenePrompt(
      description.trim(),
      typeof genre === "string" ? genre : undefined,
      typeof tone === "string" ? tone : undefined,
    );
    const isV2 = isV2User(userEmail);

    // Image gen — landscape with automatic fallback. gpt-image-2 first
    // for v2 users; dall-e-3 fallback if it fails. dall-e-3's nearest
    // landscape is 1792x1024 (16:9, slightly wider than 7:5 but
    // acceptable; sharp will center-crop to 7:5).
    const sizes = { gptImage2: "1536x1024" as const, dallE3: "1792x1024" as const };
    const attempt = await generateImageWithFallback({
      apiKey,
      prompt,
      sizes,
      context: "generate-scene-image",
      preferV2: isV2,
    });
    if (!attempt.ok) {
      void logUsage({
        userEmail,
        projectId: projectId ?? null,
        projectName: projectName ?? null,
        targetId: beatId ?? null,
        targetName: targetName ?? null,
        draftId: draftId ?? null,
        draftLabel: draftLabel ?? null,
        provider: "openai",
        kind: "image",
        model: isV2 ? "gpt-image-2" : "dall-e-3",
        action: "generate_scene_image",
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
      projectName: projectName ?? null,
      targetId: beatId ?? null,
      targetName: targetName ?? null,
      draftId: draftId ?? null,
      draftLabel: draftLabel ?? null,
      provider: "openai",
      kind: "image",
      model: attempt.model,
      action: "generate_scene_image",
      image: {
        count: 1,
        size: attempt.model === "gpt-image-2" ? sizes.gptImage2 : sizes.dallE3,
      },
    });
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

    // Server-side durability: write the URL into the beat's row so
    // the thumbnail survives client navigation during the gen. AWAIT
    // — Vercel kills pending async work the moment the response
    // returns, so fire-and-forget here would orphan the URL.
    if (projectId && beatId && thumbnail) {
      await setBeatThumbnail(projectId, beatId, thumbnail);
    }

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
