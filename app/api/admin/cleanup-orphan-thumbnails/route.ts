// One-shot admin endpoint that finds orphaned objects in the
// character-images + scene-images Storage buckets and (optionally)
// deletes them.
//
// "Orphan" = a Storage object whose public URL is not referenced by
// any row's `data` JSONB or `thumbnail` column in the projects table.
// These accumulate when:
//   1. An auto-gen succeeds (Storage uploaded), but the autosave that
//      should have persisted the URL into the row was silently
//      rejected (statement_timeout / row-too-big era).
//   2. The thumbnail migration runs but its trailing setStory's
//      autosave fails, so the next reload re-runs the migration and
//      uploads another copy.
//   3. Future cases: character or scene gets manually regenerated, or
//      a project gets deleted without cascade-cleaning its thumbnails.
//
// Usage from the browser console (signed in, beta-allowlisted email):
//
//   // 1. Dry run — list orphans without deleting:
//   fetch('/api/admin/cleanup-orphan-thumbnails', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ dryRun: true }),
//   }).then(r => r.json()).then(console.log);
//
//   // 2. After reviewing the report, actually delete:
//   fetch('/api/admin/cleanup-orphan-thumbnails', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ dryRun: false }),
//   }).then(r => r.json()).then(console.log);
//
// The endpoint requires SUPABASE_SERVICE_ROLE_KEY (admin client used
// for both bucket listing AND a cross-user `projects` scan that
// bypasses RLS — necessary so we know which Storage URLs are still
// "live" in anyone's row, not just the caller's).

import { isBetaAllowed, BETA_FORBIDDEN_RESPONSE } from "@/lib/betaAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKETS = ["character-images", "scene-images"] as const;
type BucketName = (typeof BUCKETS)[number];

interface BucketReport {
  totalObjects?: number;
  orphanCount?: number;
  deleted?: number;
  sampleOrphans?: string[];
  error?: string;
  partialDeleted?: number;
}

interface CleanupReport {
  dryRun: boolean;
  referencedUrlsTotal: number;
  buckets: Record<BucketName, BucketReport>;
}

export async function POST(req: Request) {
  if (!isBetaAllowed(req.headers.get("x-user-email"))) {
    return Response.json(BETA_FORBIDDEN_RESPONSE.body, {
      status: BETA_FORBIDDEN_RESPONSE.status,
    });
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return new Response(JSON.stringify({ error: "Storage admin not configured (SUPABASE_SERVICE_ROLE_KEY missing)" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  let payload: any = {};
  try {
    payload = await req.json();
  } catch { /* no body — treat as dry run by default */ }
  const dryRun = payload?.dryRun !== false; // default true

  // 1. Pull every projects row's data + thumbnail. Admin client
  //    bypasses RLS so we see everyone's. This is fine for an
  //    orphan-detection job (no PII exfiltration — we only build a
  //    Set of URLs).
  const { data: allProjects, error: projectsErr } = await admin
    .from("projects")
    .select("id, data, thumbnail");
  if (projectsErr) {
    return new Response(JSON.stringify({ error: `projects query failed: ${projectsErr.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Walk every project's data + thumbnail and collect every
  //    Storage URL referenced anywhere. The walker handles nested
  //    arrays / objects / strings without knowing the schema.
  const referencedUrls = new Set<string>();
  const STORAGE_PATH_FRAGMENT = "/storage/v1/object/public/";
  for (const row of allProjects ?? []) {
    const stack: unknown[] = [row.thumbnail, row.data];
    while (stack.length) {
      const item = stack.pop();
      if (typeof item === "string") {
        if (item.includes(STORAGE_PATH_FRAGMENT)) referencedUrls.add(item);
      } else if (Array.isArray(item)) {
        for (const v of item) stack.push(v);
      } else if (item && typeof item === "object") {
        for (const v of Object.values(item as Record<string, unknown>)) stack.push(v);
      }
    }
  }

  const report: CleanupReport = {
    dryRun,
    referencedUrlsTotal: referencedUrls.size,
    buckets: {} as Record<BucketName, BucketReport>,
  };

  // 3. For each bucket, list every object; for each object, derive its
  //    public URL via the same helper that wrote it; orphan = not in
  //    the referenced set.
  for (const bucket of BUCKETS) {
    const bucketReport: BucketReport = {};
    const orphans: string[] = [];
    let totalCount = 0;
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data: objects, error: listErr } = await admin.storage.from(bucket).list("", {
        limit: pageSize,
        offset,
        sortBy: { column: "created_at", order: "asc" },
      });
      if (listErr) {
        bucketReport.error = `list error: ${listErr.message}`;
        break;
      }
      if (!objects || objects.length === 0) break;
      // Storage list returns folder entries with no `id`/`metadata` — skip
      // those defensively, even though our flat layout shouldn't produce any.
      const realObjects = objects.filter(o => o.id);
      totalCount += realObjects.length;
      for (const obj of realObjects) {
        const { data: { publicUrl } } = admin.storage.from(bucket).getPublicUrl(obj.name);
        if (!referencedUrls.has(publicUrl)) {
          orphans.push(obj.name);
        }
      }
      if (objects.length < pageSize) break;
      offset += pageSize;
    }
    bucketReport.totalObjects = totalCount;
    bucketReport.orphanCount = orphans.length;
    bucketReport.sampleOrphans = orphans.slice(0, 5);

    // 4. If not dry-run, delete orphans in batches of 100.
    if (!dryRun && orphans.length > 0 && !bucketReport.error) {
      let deleted = 0;
      for (let i = 0; i < orphans.length; i += 100) {
        const chunk = orphans.slice(i, i + 100);
        const { error: delErr } = await admin.storage.from(bucket).remove(chunk);
        if (delErr) {
          bucketReport.error = `delete batch starting at ${i}: ${delErr.message}`;
          bucketReport.partialDeleted = deleted;
          break;
        }
        deleted += chunk.length;
      }
      bucketReport.deleted = deleted;
    } else {
      bucketReport.deleted = 0;
    }

    report.buckets[bucket] = bucketReport;
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
