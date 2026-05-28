// Admin one-shot. Grants `granteeEmail` collaborator access to a
// specific project owned by `ownerEmail`. Used to share an existing
// project without the normal invite flow (e.g. you want into a
// family member's project to pull asset/placeholder content out).
//
// What "collaborator" means here: the `projects` row has a single
// `collaborator_user_id` column. RLS allows SELECT when auth.uid()
// matches either `user_id` or `collaborator_user_id`. Setting this
// field is the entire grant — no invite token / acceptance row
// needed for the access itself.
//
// Usage from the admin's browser console (signed in):
//
//   // Dry run — confirms users + project resolved before writing:
//   fetch('/api/admin/grant-collaborator?ownerEmail=…&granteeEmail=…&projectTitle=Buck+Mark&dryRun=true')
//     .then(r => r.json()).then(console.log)
//
//   // Actually grant:
//   fetch('/api/admin/grant-collaborator?ownerEmail=…&granteeEmail=…&projectTitle=Buck+Mark', {
//     method: 'POST'
//   }).then(r => r.json()).then(console.log)
//
// Idempotent: if collaborator_user_id is already set to the grantee,
// the response confirms the no-op rather than erroring. If a different
// collaborator is currently set, the call fails — projects only
// support a single partner today, so a swap is a manual decision.

import { isAdmin } from "@/lib/adminEmails";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveUserIdByEmail(
  admin: ReturnType<typeof getSupabaseAdmin>,
  email: string,
): Promise<string | null> {
  if (!admin) return null;
  const target = email.toLowerCase().trim();
  // Single-page listUsers — works as long as the workspace has
  // <1000 accounts. The auth.admin API doesn't expose a direct
  // email lookup; this is the canonical workaround.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw new Error(`auth.admin.listUsers failed: ${error.message}`);
  }
  const match = data.users.find(
    u => (u.email ?? "").toLowerCase().trim() === target,
  );
  return match?.id ?? null;
}

async function handle(req: Request, isDryRun: boolean): Promise<Response> {
  const userEmail = req.headers.get("x-user-email");
  if (!isAdmin(userEmail)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const ownerEmail = url.searchParams.get("ownerEmail")?.trim();
  const granteeEmail = url.searchParams.get("granteeEmail")?.trim();
  const projectTitle = url.searchParams.get("projectTitle")?.trim();
  const projectId = url.searchParams.get("projectId")?.trim();

  if (!ownerEmail || !granteeEmail || (!projectTitle && !projectId)) {
    return new Response(
      JSON.stringify({
        error: "missing params",
        required: ["ownerEmail", "granteeEmail", "projectTitle (or projectId)"],
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Resolve both emails → user_ids.
  let ownerId: string | null = null;
  let granteeId: string | null = null;
  try {
    [ownerId, granteeId] = await Promise.all([
      resolveUserIdByEmail(admin, ownerEmail),
      resolveUserIdByEmail(admin, granteeEmail),
    ]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!ownerId) {
    return new Response(
      JSON.stringify({ error: `owner ${ownerEmail} not found in auth.users` }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!granteeId) {
    return new Response(
      JSON.stringify({ error: `grantee ${granteeEmail} not found in auth.users` }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }
  if (ownerId === granteeId) {
    return new Response(
      JSON.stringify({ error: "owner and grantee are the same user — nothing to grant" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Resolve project. Prefer explicit projectId; fall back to title.
  // Title resolution: the title lives inside `data.title` JSONB; an
  // ilike on the cast handles case-insensitive matching.
  let row: { id: string; title: string | null; collaborator_user_id: string | null } | null = null;
  if (projectId) {
    const { data, error } = await admin
      .from("projects")
      .select("id, data, collaborator_user_id")
      .eq("id", projectId)
      .eq("user_id", ownerId)
      .maybeSingle();
    if (error) {
      return new Response(JSON.stringify({ error: `project lookup: ${error.message}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (data) {
      row = {
        id: data.id,
        title: (data.data as { title?: string } | null)?.title ?? null,
        collaborator_user_id: data.collaborator_user_id,
      };
    }
  } else if (projectTitle) {
    const { data, error } = await admin
      .from("projects")
      .select("id, data, collaborator_user_id")
      .eq("user_id", ownerId);
    if (error) {
      return new Response(JSON.stringify({ error: `project list: ${error.message}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const wanted = projectTitle.toLowerCase();
    const match = (data ?? []).find(p => {
      const t = (p.data as { title?: string } | null)?.title ?? "";
      return t.toLowerCase() === wanted;
    });
    if (match) {
      row = {
        id: match.id,
        title: (match.data as { title?: string } | null)?.title ?? null,
        collaborator_user_id: match.collaborator_user_id,
      };
    } else {
      // Surface what titles ARE owned by this user so the caller can
      // re-issue with the right string.
      const owned = (data ?? []).map(p => (p.data as { title?: string } | null)?.title ?? "(untitled)");
      return new Response(
        JSON.stringify({
          error: `no project titled ${JSON.stringify(projectTitle)} owned by ${ownerEmail}`,
          ownerProjects: owned,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  if (!row) {
    return new Response(
      JSON.stringify({ error: "project not found for this owner" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Idempotency + conflict handling.
  if (row.collaborator_user_id === granteeId) {
    return new Response(
      JSON.stringify({
        ok: true,
        noop: true,
        message: "grantee is already the collaborator on this project",
        projectId: row.id,
        title: row.title,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (row.collaborator_user_id && row.collaborator_user_id !== granteeId) {
    return new Response(
      JSON.stringify({
        error: "project already has a different collaborator — projects support one partner today; remove the existing one first",
        projectId: row.id,
        title: row.title,
        existingCollaboratorId: row.collaborator_user_id,
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  if (isDryRun) {
    return new Response(
      JSON.stringify({
        ok: true,
        dryRun: true,
        wouldGrant: {
          projectId: row.id,
          title: row.title,
          ownerEmail,
          ownerId,
          granteeEmail,
          granteeId,
        },
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Commit.
  const { error: updErr } = await admin
    .from("projects")
    .update({ collaborator_user_id: granteeId })
    .eq("id", row.id);
  if (updErr) {
    return new Response(JSON.stringify({ error: `update failed: ${updErr.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      ok: true,
      projectId: row.id,
      title: row.title,
      ownerEmail,
      granteeEmail,
      message: "collaborator_user_id set — grantee can now load this project as a partner",
    }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export function GET(req: Request) {
  return handle(req, true);
}

export function POST(req: Request) {
  // Honors ?dryRun=true on POST too in case you want to preview
  // server-side validation before writing.
  const isDryRun = new URL(req.url).searchParams.get("dryRun") === "true";
  return handle(req, isDryRun);
}
