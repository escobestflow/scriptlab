// Project-collaboration invites.
//
// The creator of a project issues an invite token via createInvite().
// They share a URL like https://<app>/accept-invite/<token> with the
// person they want to work with. The invitee signs in (if not already)
// and visits the URL; acceptInvite() flips the invite row to
// "accepted", sets the creator's project row's collaborator_user_id
// to the invitee, and seeds the invitee's own project row as an
// empty Story keyed to the same project id.
//
// Single-user projects never touch this module. Everything here is
// additive — nothing in the existing load/save path references it.

import { supabase } from "./supabase";

function randomToken(): string {
  // 32 hex chars. Unguessable for our scale; short enough to fit in
  // a URL without wrapping. crypto.getRandomValues preferred; Math.random
  // fallback is only here so we don't crash on an exotic runtime.
  const arr = new Uint8Array(16);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

export interface Invite {
  token: string;
  projectId: string;
  creatorUserId: string;
  createdAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

function rowToInvite(r: any): Invite {
  return {
    token: r.token,
    projectId: r.project_id,
    creatorUserId: r.creator_user_id,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
    acceptedBy: r.accepted_by,
  };
}

/**
 * Mint a new invite for a project. Returns the Invite (with token)
 * or null on failure. Callers are responsible for sharing the token
 * URL — this module does not send emails.
 */
export async function createInvite(projectId: string, creatorUserId: string): Promise<Invite | null> {
  const token = randomToken();
  const { data, error } = await supabase
    .from("project_invites")
    .insert({ token, project_id: projectId, creator_user_id: creatorUserId })
    .select()
    .single();
  if (error || !data) {
    console.error("createInvite error:", error);
    return null;
  }
  return rowToInvite(data);
}

/**
 * All invites I've issued for this project. Used by the "pending
 * invites" list in project settings so the creator can copy a link
 * or revoke one. Only non-accepted invites are typically surfaced.
 */
export async function listInvitesForProject(projectId: string, creatorUserId: string): Promise<Invite[]> {
  const { data, error } = await supabase
    .from("project_invites")
    .select("*")
    .eq("project_id", projectId)
    .eq("creator_user_id", creatorUserId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToInvite);
}

export async function revokeInvite(token: string): Promise<void> {
  await supabase.from("project_invites").delete().eq("token", token);
}

export interface AcceptResult {
  projectId: string;
  creatorUserId: string;
}

export type AcceptError =
  | "not-found"
  | "already-used"
  | "self-accept"
  | "project-full"
  | "project-missing"
  | "write-failed";

/**
 * Accept an invite as the signed-in user. Delegates to the server-
 * side `accept_invite` SQL RPC because RLS prevents the invitee
 * from reading the creator's project row (they are not yet the
 * collaborator). The RPC runs SECURITY DEFINER, which lets it read
 * + write across both users' rows while still enforcing the
 * invite/ownership rules internally.
 *
 * Return shape matches the original client-side implementation so
 * the caller (the /accept-invite page) does not need to change.
 */
export async function acceptInvite(
  token: string,
  _accepterUserId: string,
): Promise<AcceptResult | AcceptError> {
  const { data, error } = await supabase.rpc("accept_invite", {
    invite_token: token,
  });
  if (error) {
    console.error("accept_invite RPC error:", error);
    return "write-failed";
  }
  if (!data) return "write-failed";

  // The RPC returns either { projectId, creatorUserId } on success
  // or { error: <AcceptError> } on a handled failure.
  const obj = data as Record<string, any>;
  if (obj.error) {
    const err = obj.error as string;
    const known: AcceptError[] = [
      "not-found", "already-used", "self-accept",
      "project-full", "project-missing", "write-failed",
    ];
    if (known.includes(err as AcceptError)) return err as AcceptError;
    return "write-failed";
  }
  if (obj.projectId && obj.creatorUserId) {
    return { projectId: obj.projectId, creatorUserId: obj.creatorUserId };
  }
  return "write-failed";
}

/**
 * Build the shareable URL for an invite token. Reads window.location
 * on the client; returns a path-only string during SSR.
 */
export function buildInviteUrl(token: string): string {
  if (typeof window === "undefined") return `/accept-invite/${token}`;
  return `${window.location.origin}/accept-invite/${token}`;
}
