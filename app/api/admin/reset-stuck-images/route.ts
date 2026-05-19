// Admin recovery endpoint. Finds characters / beats inside a project
// whose `imageGenAttempted=true` but `thumbnail` is empty — that's the
// signature of a generation that succeeded server-side, was billed,
// but had the URL-write fail before persisting. Clearing the
// `imageGenAttempted` flag lets the auto-fire effect re-trigger gen
// on the next page load.
//
// Background: see /api/generate-character-image's await-vs-void fix
// (commit 2026-05-19). Before that fix, the server's setCharacter-
// Thumbnail call was fire-and-forget — Vercel killed it the moment
// the response was sent. The flag landed (it ran before the long
// OpenAI call) but the URL didn't. Characters were left with the
// "we already tried" sentinel and no image, with no automatic
// recovery path. This endpoint is the manual fix.
//
// Usage from the admin's browser console (signed in):
//
//   // Dry run for a project, by title:
//   fetch('/api/admin/reset-stuck-images?title=Turn+Around&dryRun=true')
//     .then(r => r.json()).then(console.log)
//
//   // Actually reset:
//   fetch('/api/admin/reset-stuck-images?title=Turn+Around', { method: 'POST' })
//     .then(r => r.json()).then(console.log)
//
// Targets: characters and beats. Project-thumbnails are excluded
// because they live in a column, not the JSONB, and `imageGen-
// Attempted` doesn't apply there.

import { isAdmin } from "@/lib/adminEmails";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, unknown>;

interface StuckEntry {
  kind: "character" | "beat";
  id: string;
  name: string;
  draftId: string;
  draftLabel: string;
}

async function findAndReset(
  projectId: string,
  projectTitle: string,
  dryRun: boolean,
): Promise<{ projectId: string; projectTitle: string; stuck: StuckEntry[]; reset: boolean }> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("no service-role key");
  const { data: row, error } = await admin
    .from("projects")
    .select("data")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !row?.data) {
    return { projectId, projectTitle, stuck: [], reset: false };
  }
  const data = row.data as AnyRecord;
  const stuck: StuckEntry[] = [];

  // Characters
  const charDrafts = (data.charactersDrafts as AnyRecord[] | undefined) ?? [];
  for (const d of charDrafts) {
    const chars = (d.characters as AnyRecord[] | undefined) ?? [];
    for (const c of chars) {
      if (c.imageGenAttempted === true && !c.thumbnail) {
        stuck.push({
          kind: "character",
          id: String(c.id),
          name: String(c.name ?? "(unnamed)"),
          draftId: String(d.id),
          draftLabel: `Characters Draft ${d.number ?? "?"}`,
        });
        if (!dryRun) {
          delete (c as AnyRecord).imageGenAttempted;
        }
      }
    }
  }

  // Beats (feature + TV)
  const storyDrafts = (data.storyDrafts as AnyRecord[] | undefined) ?? [];
  for (const d of storyDrafts) {
    const beats = (d.beats as AnyRecord[] | undefined) ?? [];
    for (const b of beats) {
      if (b.imageGenAttempted === true && !b.thumbnail) {
        stuck.push({
          kind: "beat",
          id: String(b.id),
          name: String(b.name ?? "(unnamed)"),
          draftId: String(d.id),
          draftLabel: `Story Draft ${d.number ?? "?"}`,
        });
        if (!dryRun) {
          delete (b as AnyRecord).imageGenAttempted;
        }
      }
    }
    const eps = (d.episodes as AnyRecord[] | undefined) ?? [];
    for (const ep of eps) {
      const epBeats = (ep.beats as AnyRecord[] | undefined) ?? [];
      for (const b of epBeats) {
        if (b.imageGenAttempted === true && !b.thumbnail) {
          stuck.push({
            kind: "beat",
            id: String(b.id),
            name: String(b.name ?? "(unnamed)"),
            draftId: String(d.id),
            draftLabel: `Story Draft ${d.number ?? "?"} (Ep ${ep.number ?? "?"})`,
          });
          if (!dryRun) {
            delete (b as AnyRecord).imageGenAttempted;
          }
        }
      }
    }
  }

  if (!dryRun && stuck.length > 0) {
    const { error: writeErr } = await admin
      .from("projects")
      .update({ data, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (writeErr) {
      return { projectId, projectTitle, stuck, reset: false };
    }
  }
  return { projectId, projectTitle, stuck, reset: !dryRun };
}

// Resolves a project by exact title (case-insensitive). Returns ALL
// matches across all users — the admin can disambiguate from the
// response. Most projects have unique titles in practice.
async function resolveProjects(title: string): Promise<{ id: string; title: string }[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from("projects")
    .select("id, data");
  if (error || !data) return [];
  const lc = title.toLowerCase();
  const matches: { id: string; title: string }[] = [];
  for (const r of data) {
    const d = r.data as AnyRecord | null;
    const t = String(d?.title ?? "").trim();
    if (t.toLowerCase() === lc) matches.push({ id: String(r.id), title: t });
  }
  return matches;
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
    for (const t of targets) {
      results.push(await findAndReset(t.id, t.title, dryRun));
    }
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

// GET → dry run by default (lists what would be reset)
// POST → actually reset (unless ?dryRun=true override)
export const GET  = (req: Request) => handle(req, true);
export const POST = (req: Request) => handle(req, false);
