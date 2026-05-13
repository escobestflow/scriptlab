// One-shot migration endpoint that converts an inline base64 image
// data URL into a Supabase Storage URL. The client calls this in
// the background for every character / beat whose `thumbnail` field
// is still in legacy data-URL form — see `migrateLegacyThumbnails`
// in components/Studio.tsx.
//
// Request body:
//   {
//     dataUrl: string,                  // "data:image/jpeg;base64,..." (or png/webp)
//     bucket: "character-images" | "scene-images"
//   }
//
// Success response:
//   { url: string }                     // the new public Storage URL
//
// Failure response:
//   { error: string }                   // human-readable
//
// SUPABASE_SERVICE_ROLE_KEY must be configured on the server. When
// it's not, the upload helper returns the original data URL back,
// so the client will see no migration progress until the env var is
// added — and no data is lost.

import { isBetaAllowed, BETA_FORBIDDEN_RESPONSE } from "@/lib/betaAccess";
import { uploadJpegToStorage, decodeDataUrl, type ImageBucket } from "@/lib/imageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_BUCKETS: ImageBucket[] = ["character-images", "scene-images"];

export async function POST(req: Request) {
  if (!isBetaAllowed(req.headers.get("x-user-email"))) {
    return Response.json(BETA_FORBIDDEN_RESPONSE.body, {
      status: BETA_FORBIDDEN_RESPONSE.status,
    });
  }
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const dataUrl = typeof payload?.dataUrl === "string" ? payload.dataUrl : "";
  const bucket = payload?.bucket;
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return new Response(JSON.stringify({ error: "Invalid bucket" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!dataUrl.startsWith("data:image/")) {
    return new Response(JSON.stringify({ error: "Not a data URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const buf = decodeDataUrl(dataUrl);
  if (!buf) {
    return new Response(JSON.stringify({ error: "Unparseable data URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Hard ceiling on accepted payload size — 6MB is well above the
  // ~80KB our generator produces, with room for unusually-large
  // user uploads, but cheap enough that a misbehaving caller can't
  // exhaust the function's memory.
  if (buf.length > 6 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: "Payload too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await uploadJpegToStorage(bucket, buf);
  if (result.mode === "inline") {
    // Service role key not configured — we have nothing to migrate
    // TO. Surface so the client doesn't burn cycles re-trying.
    return new Response(JSON.stringify({ error: "Storage not configured (SUPABASE_SERVICE_ROLE_KEY missing)" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ url: result.thumbnail }), {
    headers: { "Content-Type": "application/json" },
  });
}
