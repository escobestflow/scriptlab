// Generates a TV episode thumbnail. Adjacent to /api/generate-scene-
// image but episode-shaped: the prompt builds from the episode's title
// + logline rather than a single beat's summary, and the output is a
// wider 16:9 frame (closer to a key-art / opening-title still than a
// single-scene moment).
//
// Sharp center-crops to 16:9 (768x432 stored, comfortable density for
// the v2 episode card which displays at 248x140 logical / 496x280
// retina) and JPEG-compresses before returning.

import sharp from "sharp";
import { isBetaAllowed, BETA_FORBIDDEN_RESPONSE } from "@/lib/betaAccess";
import { generateImageWithFallback } from "@/lib/imageGenWithFallback";
import { uploadJpegToStorage } from "@/lib/imageStorage";
import { logUsage } from "@/lib/usageLog";
import {
  markEpisodeAttempted,
  setEpisodeThumbnail,
  clearEpisodeAttempted,
} from "@/lib/projectImagePersist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Episode-image prompt. Tone palette and rendering style mirror the
 *  scene-image prompt so cards in one project read as a coherent
 *  visual set; the per-episode variation comes only from the episode's
 *  logline + title. The framing brief leans key-art (room to hold a
 *  title overlay later) rather than mid-scene action — episode cards
 *  sit above per-beat scene cards in the visual hierarchy. */
function buildEpisodePrompt(
  title: string,
  logline: string,
  projectGenre?: string,
  projectTone?: string,
): string {
  const toneByGenre: Record<string, string> = {
    comedy:    "warm cinematic key art, painterly brush texture, soft natural daylight, gentle shadow falloff, muted warm-neutral palette, restrained contrast",
    romance:   "soft cinematic key art, golden-hour light, painterly shadow falloff, muted warm cream and amber palette, restrained contrast",
    horror:    "high-contrast moody cinematic key art, harsh single-source light, deep shadow falloff, muted near-black with cold highlights, elevated contrast",
    "sci-fi":  "cool cinematic key art, painterly brush texture, clean directional light, subtle shadow falloff, muted slate-blue and steel palette, restrained contrast",
    fantasy:   "cinematic key art with subtle storybook quality, painterly brush texture, warm directional light, muted moss-and-amber palette, restrained contrast",
    drama:     "elevated cinematic key art, soft directional light, painterly shadow falloff, muted warm-neutral palette, restrained contrast",
  };
  const fallback = "moody cinematic key art, elevated psychological thriller aesthetic, dark atmospheric lighting, soft film grain, painterly detail, dramatic contrast, restrained color palette of muted charcoal, deep teal, desaturated blue-gray with warm amber highlights only when needed";
  const genreKey = (projectGenre || "").toLowerCase();
  const tone = toneByGenre[genreKey] || fallback;
  const toneLine = (projectTone || "").trim()
    ? `\nProject tone: ${projectTone!.trim()}.`
    : "";

  return `Create a TV episode thumbnail for a screenplay writing app.

Style: semi-realistic digital painting, subtle oil-painted finish, ${tone}, premium prestige-TV key art, not a photograph.${toneLine}

Visual tone: cinematic, emotionally charged, with room for a title to sit cleanly over the composition. Avoid bright colors, glossy realism, over-sharpened detail, or clean commercial photography.

Composition: wide 16:9 landscape, single clear focal point, strong depth, painterly framing, generous negative space (the bottom third should read as "place a title here"), simple readable silhouette, no text, no logos, no borders. The image should feel like the opening frame of a prestige-TV episode.

Lighting: low-key lighting, soft directional light, heavy shadow falloff, atmospheric haze, restrained highlights, realistic but painterly texture.

Rendering: semi-realistic painted film still, not hyperrealistic, not a real photo, not cartoon, not anime. Smooth painterly surfaces, subtle brush texture, cinematic matte finish.

Episode title: ${title || "(untitled)"}
Episode logline: ${logline}`;
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
    const { title, logline, genre, tone, projectId, episodeId, projectName, targetName, draftId, draftLabel, model } = await req.json();
    if (!logline || typeof logline !== "string" || !logline.trim()) {
      return new Response(JSON.stringify({ error: "logline required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const forceModel: "dall-e-3" | "gpt-image-2" | undefined =
      model === "dall-e-3" || model === "gpt-image-2" ? model : undefined;

    // Credit-bleed guard: mark imageGenAttempted=true on the episode
    // row BEFORE the slow OpenAI call so a mid-gen page refresh
    // doesn't re-fire the auto-loop and double-spend.
    if (projectId && episodeId) {
      await markEpisodeAttempted(projectId, episodeId);
    }

    const prompt = buildEpisodePrompt(
      typeof title === "string" ? title : "",
      logline.trim(),
      typeof genre === "string" ? genre : undefined,
      typeof tone === "string" ? tone : undefined,
    );

    // Server default: dall-e-3. The "Premium Image Quality" toggle in
    // Settings is the only path that flips this — it sends
    // `model: "gpt-image-2"` explicitly via the client. preferV2 stays
    // false here so a client that omits `model` still gets the cheap
    // default.
    const sizes = { gptImage2: "1536x768" as const, dallE3: "1792x1024" as const };
    const attempt = await generateImageWithFallback({
      apiKey,
      prompt,
      sizes,
      context: "generate-episode-image",
      preferV2: false,
      forceModel,
    });
    const attemptedModel = forceModel ?? "dall-e-3";
    if (!attempt.ok) {
      void logUsage({
        userEmail,
        projectId: projectId ?? null,
        projectName: projectName ?? null,
        targetId: episodeId ?? null,
        targetName: targetName ?? null,
        draftId: draftId ?? null,
        draftLabel: draftLabel ?? null,
        provider: "openai",
        kind: "image",
        model: attemptedModel,
        action: "generate_episode_image",
        image: { count: 1, size: attemptedModel === "gpt-image-2" ? sizes.gptImage2 : sizes.dallE3 },
        error: `${attempt.code ?? "error"}: ${attempt.error}`,
      });
      // Undo the pre-call markEpisodeAttempted=true stamp so auto-gen
      // can retry on the next session. Otherwise a one-off transient
      // failure burns the episode's auto-gen budget permanently.
      if (projectId && episodeId) {
        await clearEpisodeAttempted(projectId, episodeId);
      }
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
      targetId: episodeId ?? null,
      targetName: targetName ?? null,
      draftId: draftId ?? null,
      draftLabel: draftLabel ?? null,
      provider: "openai",
      kind: "image",
      model: attempt.model,
      action: "generate_episode_image",
      image: {
        count: 1,
        size: attempt.model === "gpt-image-2" ? sizes.gptImage2 : sizes.dallE3,
      },
    });
    const b64 = attempt.b64;

    // Compress: source → 768x432 (16:9) JPEG. Card displays at
    // 248x140 logical / 496x280 retina, so 768x432 has plenty of
    // pixel density without bloating storage.
    const pngBuffer = Buffer.from(b64, "base64");
    const jpegBuffer = await sharp(pngBuffer)
      .resize(768, 432, { fit: "cover", position: "attention" })
      .jpeg({ quality: 80 })
      .toBuffer();

    const { thumbnail } = await uploadJpegToStorage("episode-images", jpegBuffer);

    // Server-side durability: write the URL into the episode's row.
    if (projectId && episodeId && thumbnail) {
      await setEpisodeThumbnail(projectId, episodeId, thumbnail);
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
