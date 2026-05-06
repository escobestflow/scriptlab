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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Beta gate — see app/api/generate/route.ts for the rationale.
  if (!isBetaAllowed(req.headers.get("x-user-email"))) {
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
    const { title, logline, genres, extra } = await req.json();

    // Stage 1: Claude composes the locked-style image brief.
    const prompt = await buildImagePrompt(
      { title, logline, genres, extra },
      anthropicKey,
    );

    // Stage 2: route by design tier. V2 users get gpt-image-2 (better
    // quality, ~5× the cost); v1 stays on dall-e-3 (legacy, cheaper).
    // Wide landscape framing for both models — the same source image
    // is reused at every placement on the dashboard.
    const isV2 = isV2User(req.headers.get("x-user-email"));
    const imageBody = isV2
      ? {
          model: "gpt-image-2",
          prompt,
          n: 1,
          size: "1536x768",    // 2:1 landscape — valid for gpt-image-2 (edges %16, ratio ≤ 3:1)
          quality: "high",
          // NOTE: no response_format. gpt-image-2 always returns
          // base64 in data[0].b64_json — passing response_format
          // causes a 400 "Unknown parameter".
        }
      : {
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1792x1024",   // dall-e-3's widest native landscape (~16:9)
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
