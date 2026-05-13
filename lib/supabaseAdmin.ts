// Server-side Supabase client using the SERVICE ROLE key. Bypasses
// RLS — for trusted server contexts only (API routes, server actions).
//
// Lazily created so build-time env-var inspection doesn't reach for
// the key on the client. Returns null when the env var isn't set so
// callers can fall back to the legacy inline-base64 path gracefully —
// see `lib/imageStorage.ts`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined = undefined;

/** Returns an admin Supabase client, or null when SUPABASE_SERVICE_ROLE_KEY
 *  isn't configured in the environment. Memoized after the first call. */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    cached = null;
    return null;
  }
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
