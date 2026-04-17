// Generates a project thumbnail via a two-stage pipeline:
//   1. Claude Haiku builds a locked-style cinematic-minimalist movie-poster prompt.
//   2. DALL-E 3 renders it at 1024x1792 (closest native vertical ratio).
//   3. Sharp center-crops/resizes to 192x256 (3:4) JPEG (~15-25KB) for localStorage.

import sharp from "sharp";
import { buildImagePrompt } from "@/lib/thumbnailPrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
    const { title, logline, genres } = await req.json();

    // Stage 1: Claude composes the locked-style image brief.
    const prompt = await buildImagePrompt(
      { title, logline, genres },
      anthropicKey,
    );

    // Stage 2: DALL-E 3 renders the prompt at vertical 1024x1792.
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1792",
        response_format: "b64_json",
        quality: "standard",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `DALL-E error: ${err}` }), {
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
