// User profiles — stores a first name per auth user for collab UX.
//
// The `profiles` table is defined in supabase/collab-profiles.sql. The
// only field we actually render today is `displayName`, shown:
//   * inside the overlapping initials chip on every layer bar
//     (first letter preferred over the email fallback), and
//   * (future) anywhere we address the partner by name.
//
// Writes are owner-only via RLS. Reads are allowed for any authenticated
// caller so each side of a collab can render the partner's initial.

import { supabase } from "./supabase";

export interface Profile {
  userId: string;
  displayName: string | null;
  email: string | null;
}

/** Load the current user's own profile row, or null if none yet. */
export async function loadMyProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, email")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) {
    console.error("loadMyProfile error:", error);
    return null;
  }
  if (!data) return null;
  return {
    userId: data.user_id,
    displayName: data.display_name ?? null,
    email: data.email ?? null,
  };
}

/**
 * Upsert the signed-in user's display name. Called by the
 * NameCaptureModal's Save button. Returns true on success.
 *
 * Trims whitespace and refuses an empty string — an empty name would
 * re-trigger the modal on next entry anyway, so we block it at source.
 */
export async function saveMyDisplayName(displayName: string): Promise<boolean> {
  const trimmed = displayName.trim();
  if (!trimmed) return false;
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return false;
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: user.id,
        display_name: trimmed,
        email: user.email ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) {
    console.error("saveMyDisplayName error:", error);
    return false;
  }
  return true;
}
