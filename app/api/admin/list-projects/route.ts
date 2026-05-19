// Admin-only diagnostic: lists every row in `public.projects`.
// Useful for debugging "deleted projects coming back" — surfaces
// the actual current row set with id, title, owner, updated_at,
// and the collaborator pointer.
//
// Usage from the admin's browser console (signed in):
//
//   fetch('/api/admin/list-projects').then(r => r.json()).then(console.log)

import { isAdmin } from "@/lib/adminEmails";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdmin(req.headers.get("x-user-email"))) {
    return new Response(JSON.stringify({ error: "not authorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return new Response(JSON.stringify({ error: "no service role" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { data, error } = await admin
    .from("projects")
    .select("id, user_id, collaborator_user_id, data, updated_at")
    .order("updated_at", { ascending: false });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const rows = (data ?? []).map(r => ({
    id: r.id,
    title: (r.data as Record<string, unknown> | null)?.title ?? "(untitled)",
    user_id: r.user_id,
    collaborator_user_id: r.collaborator_user_id,
    updated_at: r.updated_at,
  }));
  return new Response(JSON.stringify({ count: rows.length, rows }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
