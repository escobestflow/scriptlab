// Generates a project thumbnail via a two-stage pipeline:
//   1. Claude Haiku builds a locked-style cinematic-minimalist movie-poster prompt.
//   2. Image model renders it at vertical native resolution.
//        - V2 users: gpt-image-2 @ 1024x1536, quality=high (~$0.19/image,
//          OpenAI's SOTA Apr 2026 model — better instruction following,
//          text rendering, photorealism).
//        - V1 users: dall-e-3 @ 1024x1792, quality=standard (~$0.04/image,
//          legacy model, kept until v2 is the global default).
//   3. Sharp center-crops/resizes to 192x256 (3:4) JPEG (~15-25KB) for localStorage.
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
    const isV2 = isV2User(req.headers.get("x-user-email"));
    const imageBody = isV2
      ? {
          model: "gpt-image-2",
          prompt,
          n: 1,
          size: "1024x1536",   // 2:3 portrait — valid for gpt-image-2 (edges %16, ratio ≤ 3:1)
          response_format: "b64_json",
          quality: "high",
        }
      : {
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1792",   // dall-e-3's tallest native portrait
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

    // Compress: 1024x1792 PNG → 192x256 JPEG 3:4 (cover-cropped).
    const pngBuffer = Buffer.from(b64, "base64");
    const jpegBuffer = await sharp(pngBuffer)
      .resize(192, 256, { fit: "cover", position: "attention" })
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
