// Generates a project thumbnail via a two-stage pipeline:
//   1. Claude Haiku fills in the cinematic-still prompt template
//      (see lib/thumbnailPrompt.ts) with a project-specific [SUBJECT].
//   2. Image model renders it at WIDE landscape aspect — the same
//      image is reused at every placement (small + hero cards) so
//      generation only ever runs once per project.
//        - V2 users: gpt-image-2 @ 1536x768 (2:1), quality=high
//          (~$0.19/image, OpenAI's SOTA Apr 2026 model).
//        - V1 users: dall-e-3 @ 1792x1024 (~16:9), quality=standard
//          (~$0.04/image, legacy model).
//   3. Sharp center-crops/resizes to 512x288 (16:9) JPEG (~50–80KB)
//      for localStorage + Supabase storage. Wider source = small
//      crop on the side margins; the 16:9 store retains enough pixel
//      density for retina hero displays at ~750x208 logical.
//
// V2 routing reads X-User-Email (auto-injected by AuthProvider's fetch
// wrapper) and checks against NEXT_PUBLIC_V2_EMAILS via isV2User. No
// caller-side flag is trusted — server is the source of truth.

import sharp from "sharp";
import { buildImagePrompt } from "@/lib/thumbnailPrompt";
import { isBetaAllowed, BETA_FORBIDDEN_RESPONSE } from "@/lib/betaAccess";
import { isV2User } from "@/lib/v2Access";
import { generateImageWithFallback } from "@/lib/imageGenWithFallback";
import { logUsage } from "@/lib/usageLog";
import { setProjectThumbnail } from "@/lib/projectImagePersist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Beta gate — see app/api/generate/route.ts for the rationale.
  const userEmail = req.headers.get("x-user-email");
  if (!isBetaAllowed(userEmail)) {
    return Response.json(BETA_FORBIDDEN_RESPONSE.body, {
      status: BETA_FORBIDDEN_RESPONSE.status,
    });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { title, logline, genres, extra, projectId } = await req.json();
    // The project's title doubles as `projectName` for dashboard rows.
    // Thumbnails don't have a more granular target (the whole project IS
    // the target), so target_id/target_name are left null. Draft is also
    // null — covers apply at project level, not per-draft.
    const projectName = typeof title === "string" ? title : null;

    // Stage 1: Claude composes the locked-style image brief.
    const stage1 = await buildImagePrompt(
      { title, logline, genres, extra },
      anthropicKey,
    );
    void logUsage({
      userEmail,
      projectId: projectId ?? null,
      projectName,
      provider: "anthropic",
      kind: "text",
      model: stage1.model,
      action: "thumbnail_prompt_build",
      textUsage: stage1.usage,
    });

    // Stage 2: route by design tier with automatic fallback. V2 users
    // try gpt-image-2 first (better quality, ~5x cost); if that fails
    // for any reason (model unavailable, content moderation, quota,
    // transient 5xx) the helper retries on dall-e-3. V1 users go
    // straight to dall-e-3. See lib/imageGenWithFallback.ts.
    const isV2 = isV2User(userEmail);
    const sizes = { gptImage2: "1536x768" as const, dallE3: "1792x1024" as const };
    const attempt = await generateImageWithFallback({
      apiKey,
      prompt: stage1.prompt,
      sizes,
      context: `generate-thumbnail project="${title || "Untitled"}"`,
      preferV2: isV2,
    });

    if (!attempt.ok) {
      void logUsage({
        userEmail,
        projectId: projectId ?? null,
        projectName,
        provider: "openai",
        kind: "image",
        model: isV2 ? "gpt-image-2" : "dall-e-3",
        action: "generate_thumbnail",
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
      projectName,
      provider: "openai",
      kind: "image",
      model: attempt.model,
      action: "generate_thumbnail",
      image: {
        count: 1,
        size: attempt.model === "gpt-image-2" ? sizes.gptImage2 : sizes.dallE3,
      },
    });

    const b64 = attempt.b64;

    // Compress: wide source PNG → 512x288 (16:9) JPEG. Source aspect
    // is ~2:1 (gpt-image-2) or ~16:9 (dall-e-3); fit:cover with
    // attention-driven cropping picks the most salient horizontal
    // slice and drops the side margins on the v2 (2:1) source.
    const pngBuffer = Buffer.from(b64, "base64");
    const jpegBuffer = await sharp(pngBuffer)
      .resize(512, 288, { fit: "cover", position: "attention" })
      .jpeg({ quality: 80 })
      .toBuffer();

    const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;

    // Server-side durability: write the URL into projects.thumbnail
    // so the cover survives client navigation during the gen. The
    // column accepts any opaque string (data URLs or Storage URLs).
    if (projectId) {
      void setProjectThumbnail(projectId, dataUrl);
    }

    return new Response(JSON.stringify({ thumbnail: dataUrl, model: attempt.model }), {
      // Same response shape as before plus a `model` field telling the
      // client which path won (gpt-image-2 vs dall-e-3 fallback). Used
      // for in-app debugging only — the frontend doesn't gate on this.
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[generate-thumbnail] uncaught:", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
