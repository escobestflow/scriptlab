// Upload AI-generated (or user-uploaded) JPEGs into Supabase Storage
// and return a public URL. Falls back to an inline base64 data URL
// when Storage isn't configured — keeps the app working in dev /
// pre-migration environments without a SUPABASE_SERVICE_ROLE_KEY.
//
// Buckets are PUBLIC-READ. The path component is a random UUID, so
// URLs are unguessable and tied 1:1 to the row that holds them.
// Cleanup of orphaned objects (when a character / beat is deleted)
// is a TODO; storage is cheap and orphans don't hurt anything.

import { getSupabaseAdmin } from "./supabaseAdmin";
import crypto from "crypto";

export type ImageBucket = "character-images" | "scene-images";

interface UploadResult {
  /** The string to store on Character.thumbnail / Beat.thumbnail.
   *  Either a public Storage URL (preferred) or an inline data URL
   *  (fallback). Render path treats both identically — `<img src>`
   *  accepts either. */
  thumbnail: string;
  /** `"storage"` when uploaded to Supabase Storage successfully;
   *  `"inline"` when the legacy data-URL fallback was used. */
  mode: "storage" | "inline";
}

/** Upload a JPEG buffer to Supabase Storage and return its public
 *  URL. If `SUPABASE_SERVICE_ROLE_KEY` is unset or the upload errors,
 *  silently falls back to an inline data URL — caller doesn't need
 *  to distinguish. */
export async function uploadJpegToStorage(
  bucket: ImageBucket,
  jpegBuffer: Buffer,
): Promise<UploadResult> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return {
      thumbnail: `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`,
      mode: "inline",
    };
  }
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await admin.storage.from(bucket).upload(path, jpegBuffer, {
    contentType: "image/jpeg",
    // 1 year browser+CDN cache. The path is unique per upload so a
    // re-generate produces a different URL — no cache-invalidation
    // problem.
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    console.error(`[uploadJpegToStorage] ${bucket} upload failed:`, error.message);
    return {
      thumbnail: `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`,
      mode: "inline",
    };
  }
  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  return { thumbnail: data.publicUrl, mode: "storage" };
}

/** Decode a `data:image/...;base64,...` URL into the raw buffer.
 *  Returns null when the string isn't a recognizable data URL. */
export function decodeDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:image\/(?:jpeg|png|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    return Buffer.from(m[1], "base64");
  } catch {
    return null;
  }
}
