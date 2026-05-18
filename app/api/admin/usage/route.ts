// Admin-only usage data endpoint. Returns the last 30 days of
// usage_log rows so the /admin/usage dashboard can render
// aggregates client-side.
//
// Gated by the hardcoded admin allowlist in `lib/usageLog.ts`
// (`isAdmin(email)`). The request's X-User-Email header is the
// caller's identity — same pattern as the rest of /api/*. Even
// though the table has RLS denying everyone except service-role,
// we still gate at the route level so the bytes never leave the
// server for non-admins.

import { isAdmin } from "@/lib/adminEmails";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userEmail = req.headers.get("x-user-email");
  if (!isAdmin(userEmail)) {
    return new Response(JSON.stringify({ error: "Not authorized." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return new Response(JSON.stringify({ error: "Service-role key not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Last 30 days, newest first, capped at 5000 rows. At ~50 calls/day
  // across the beta cohort the cap is well above expected volume;
  // it's just a safety belt against a runaway loop blowing up
  // the JSON payload.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("usage_log")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ rows: data ?? [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
