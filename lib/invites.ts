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
import { newBlankProject } from "./storage";

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
 * Accept an invite as the signed-in user. Returns the acceptance
 * details on success, or an AcceptError enum identifying what went
 * wrong. The caller (the accept-invite page) translates these into
 * human-readable messages.
 */
export async function acceptInvite(
  token: string,
  accepterUserId: string,
): Promise<AcceptResult | AcceptError> {
  // 1. Look up the invite.
  const { data: inv, error: invErr } = await supabase
    .from("project_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (invErr || !inv) return "not-found";
  if (inv.accepted_at) return "already-used";
  if (inv.creator_user_id === accepterUserId) return "self-accept";

  // 2. Fetch the creator's project row so we can (a) check that the
  //    project isn't already paired with someone else, and (b) copy
  //    title/projectType/thumbnail into the invitee's shell row so
  //    the dashboard card renders with the creator's cover image.
  const { data: creatorRow, error: rowErr } = await supabase
    .from("projects")
    .select("id, data, thumbnail, collaborator_user_id")
    .eq("id", inv.project_id)
    .eq("user_id", inv.creator_user_id)
    .maybeSingle();
  if (rowErr || !creatorRow) return "project-missing";
  if (
    creatorRow.collaborator_user_id &&
    creatorRow.collaborator_user_id !== accepterUserId
  ) {
    return "project-full";
  }

  // 3. Mark the creator's row as shared with the accepter.
  const updCreator = await supabase
    .from("projects")
    .update({ collaborator_user_id: accepterUserId })
    .eq("id", inv.project_id)
    .eq("user_id", inv.creator_user_id);
  if (updCreator.error) {
    console.error("Set creator collab error:", updCreator.error);
    return "write-failed";
  }

  // 4. Seed the invitee's own project row. We use a fresh blank
  //    Story, but override the `id` to the shared project id so both
  //    sides reference the same project. Title / projectType /
  //    thumbnail are copied forward so the dashboard card looks
  //    correct even before the invitee opens the project.
  const creatorData = (creatorRow.data ?? {}) as any;
  const shell = newBlankProject();
  const shellStory = {
    ...shell,
    id: inv.project_id,
    title: creatorData.title || shell.title,
    projectType: creatorData.projectType || shell.projectType,
  };
  const upsertInvitee = await supabase
    .from("projects")
    .upsert({
      id: inv.project_id,
      user_id: accepterUserId,
      data: shellStory,
      thumbnail: creatorRow.thumbnail ?? null,
      collaborator_user_id: inv.creator_user_id,
      updated_at: new Date().toISOString(),
    });
  if (upsertInvitee.error) {
    console.error("Seed invitee row error:", upsertInvitee.error);
    return "write-failed";
  }

  // 5. Mark the invite consumed.
  await supabase
    .from("project_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: accepterUserId })
    .eq("token", token);

  return { projectId: inv.project_id, creatorUserId: inv.creator_user_id };
}

/**
 * Build the shareable URL for an invite token. Reads window.location
 * on the client; returns a path-only string during SSR.
 */
export function buildInviteUrl(token: string): string {
  if (typeof window === "undefined") return `/accept-invite/${token}`;
  return `${window.location.origin}/accept-invite/${token}`;
}
