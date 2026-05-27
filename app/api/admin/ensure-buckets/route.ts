// Admin one-shot — provisions the Supabase Storage buckets the app
// expects. Idempotent: existing buckets are left alone, missing ones
// are created public-read.
//
// Background: when we added TV episodes, the code started uploading
// to `episode-images`, but the bucket itself was never created in
// the dashboard. Result: every episode-image gen succeeded at the
// OpenAI layer (the user got billed), then fell back to the inline
// data URL path because the upload errored. The base64 blob bloated
// every project row and never matched the storage-URL render path.
//
// Run once from the admin's browser console:
//
//   fetch('/api/admin/ensure-buckets', { method: 'POST' })
//     .then(r => r.json()).then(console.log)
//
// Returns { created: [...], existed: [...] } so you can confirm
// which buckets it touched.

import { isAdmin } from "@/lib/adminEmails";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_BUCKETS: { name: string; isPublic: boolean }[] = [
  { name: "character-images", isPublic: true },
  { name: "scene-images",     isPublic: true },
  { name: "episode-images",   isPublic: true },
];

export async function POST(req: Request) {
  const userEmail = req.headers.get("x-user-email");
  if (!isAdmin(userEmail)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return new Response(JSON.stringify({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // List existing buckets first so we know what's there. listBuckets
  // returns an array of bucket records when authorized via the
  // service-role client.
  const { data: existing, error: listErr } = await admin.storage.listBuckets();
  if (listErr) {
    return new Response(JSON.stringify({ error: `listBuckets failed: ${listErr.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const existingNames = new Set((existing ?? []).map(b => b.name));

  const created: string[] = [];
  const existed: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const b of REQUIRED_BUCKETS) {
    if (existingNames.has(b.name)) {
      existed.push(b.name);
      continue;
    }
    const { error: createErr } = await admin.storage.createBucket(b.name, {
      public: b.isPublic,
      // Default file-size limit — large enough for our 60–200KB JPEGs
      // but small enough to discourage abuse if RLS were ever relaxed.
      fileSizeLimit: 5 * 1024 * 1024, // 5MB
    });
    if (createErr) {
      failed.push({ name: b.name, error: createErr.message });
    } else {
      created.push(b.name);
    }
  }

  return new Response(JSON.stringify({ created, existed, failed }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

// Also support GET for a dry-run inventory — no creation, just a
// report of which required buckets exist.
export async function GET(req: Request) {
  const userEmail = req.headers.get("x-user-email");
  if (!isAdmin(userEmail)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return new Response(JSON.stringify({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { data, error } = await admin.storage.listBuckets();
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const existingNames = new Set((data ?? []).map(b => b.name));
  return new Response(
    JSON.stringify(
      {
        required: REQUIRED_BUCKETS.map(b => b.name),
        existing: [...existingNames],
        missing: REQUIRED_BUCKETS.filter(b => !existingNames.has(b.name)).map(b => b.name),
      },
      null,
      2,
    ),
    { headers: { "Content-Type": "application/json" } },
  );
}
