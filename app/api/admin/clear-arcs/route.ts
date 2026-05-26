// Admin-only one-off: clears the `arcs` array on every arcs draft of
// every project matching a title (or a specific projectId). Used to
// reset a project's Archs tab back to empty state for testing/QA.
//
// Usage from the admin's browser console (signed in):
//
//   // Dry run (lists what would be cleared):
//   fetch('/api/admin/clear-arcs?title=Test+TV+Series')
//     .then(r => r.json()).then(console.log)
//
//   // Actually clear:
//   fetch('/api/admin/clear-arcs?title=Test+TV+Series', { method: 'POST' })
//     .then(r => r.json()).then(console.log)

import { isAdmin } from "@/lib/adminEmails";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, unknown>;

async function resolveProjects(title: string): Promise<Array<{ id: string; title: string }>> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin.from("projects").select("id, data");
  if (error || !data) return [];
  const lc = title.toLowerCase();
  const out: Array<{ id: string; title: string }> = [];
  for (const r of data) {
    const d = r.data as AnyRecord | null;
    const t = String(d?.title ?? "").trim();
    if (t.toLowerCase() === lc) out.push({ id: String(r.id), title: t });
  }
  return out;
}

async function clearArcsOnProject(projectId: string, dryRun: boolean): Promise<{
  projectId: string;
  draftsTouched: number;
  arcsRemoved: number;
  applied: boolean;
}> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("no service-role key");
  const { data, error } = await admin
    .from("projects")
    .select("data")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data?.data) return { projectId, draftsTouched: 0, arcsRemoved: 0, applied: false };
  const d = data.data as AnyRecord;
  const drafts = (d.arcsDrafts as Array<AnyRecord> | undefined) ?? [];
  let draftsTouched = 0;
  let arcsRemoved = 0;
  const next = drafts.map(draft => {
    const arcs = (draft.arcs as unknown[] | undefined) ?? [];
    if (arcs.length === 0) return draft;
    draftsTouched++;
    arcsRemoved += arcs.length;
    return { ...draft, arcs: [], updatedAt: new Date().toISOString() };
  });
  if (!dryRun && draftsTouched > 0) {
    const patched = { ...d, arcsDrafts: next };
    const { error: writeErr } = await admin
      .from("projects")
      .update({ data: patched, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (writeErr) return { projectId, draftsTouched, arcsRemoved, applied: false };
  }
  return { projectId, draftsTouched, arcsRemoved, applied: !dryRun };
}

async function handle(req: Request, dryRunDefault: boolean) {
  if (!isAdmin(req.headers.get("x-user-email"))) {
    return new Response(JSON.stringify({ error: "not authorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const title = url.searchParams.get("title");
  const projectId = url.searchParams.get("projectId");
  const dryRunParam = url.searchParams.get("dryRun");
  const dryRun = dryRunParam === null ? dryRunDefault : dryRunParam === "true";
  if (!title && !projectId) {
    return new Response(JSON.stringify({ error: "pass ?title=<exact project title> OR ?projectId=<id>" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const targets = projectId
      ? [{ id: projectId, title: "(by id)" }]
      : await resolveProjects(title!);
    if (targets.length === 0) {
      return new Response(JSON.stringify({ error: `no project found matching title="${title}"` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const results = [];
    for (const t of targets) results.push(await clearArcsOnProject(t.id, dryRun));
    return new Response(JSON.stringify({ dryRun, results }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const GET = (req: Request) => handle(req, true);
export const POST = (req: Request) => handle(req, false);
