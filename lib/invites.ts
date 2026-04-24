// Project-collaboration invites.
//
// The creator of a project issues an invite bound to an email via
// createInvite(projectId, creatorUserId, email). When the invitee
// signs in, list_my_pending_invites returns any invites addressed
// to their email; the dashboard renders them as project cards with
// Accept / Decline buttons. Accepting calls the accept_invite RPC,
// which wires both sides (sets collaborator_user_id on the creator's
// row and seeds an empty copy on the invitee's side).
//
// A shareable /accept-invite/<token> URL is still produced for every
// invite, so the creator can paste the link if email-based discovery
// fails (e.g., the invitee signed up with a different email). The
// token is also the primary identifier used for revoke / decline.

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
  inviteeEmail: string | null;
  createdAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

function rowToInvite(r: any): Invite {
  return {
    token: r.token,
    projectId: r.project_id,
    creatorUserId: r.creator_user_id,
    inviteeEmail: r.invitee_email ?? null,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
    acceptedBy: r.accepted_by,
  };
}

/**
 * Mint an invite for a project, optionally bound to an email address.
 * When `inviteeEmail` is set, only the user whose JWT email matches
 * can accept the invite — this is what protects the dashboard
 * "Accept" button from being hijacked. The token URL is still
 * returned for link-share fallback.
 */
export async function createInvite(
  projectId: string,
  creatorUserId: string,
  inviteeEmail?: string,
): Promise<Invite | null> {
  const token = randomToken();
  const row: Record<string, any> = {
    token,
    project_id: projectId,
    creator_user_id: creatorUserId,
  };
  if (inviteeEmail && inviteeEmail.trim()) {
    row.invitee_email = inviteeEmail.trim().toLowerCase();
  }
  const { data, error } = await supabase
    .from("project_invites")
    .insert(row)
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
 * invites" list in project settings so the creator can see their
 * outstanding invites and revoke them.
 */
export async function listInvitesForProject(
  projectId: string,
  creatorUserId: string,
): Promise<Invite[]> {
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

// ── Invitee-side ──────────────────────────────────────────────────

/** One pending invite addressed to the current user, enriched with
 *  project + creator info for card rendering. */
export interface PendingInvite {
  token: string;
  projectId: string;
  projectTitle: string;
  projectType: string;
  projectThumbnail: string | null;
  creatorUserId: string;
  creatorEmail: string;
  createdAt: string;
}

export async function listMyPendingInvites(): Promise<PendingInvite[]> {
  const { data, error } = await supabase.rpc("list_my_pending_invites");
  if (error) {
    console.error("list_my_pending_invites RPC error:", error);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return (data as any[]).map(r => ({
    token: r.token,
    projectId: r.project_id,
    projectTitle: r.project_title || "",
    projectType: r.project_type || "feature",
    projectThumbnail: r.project_thumbnail ?? null,
    creatorUserId: r.creator_user_id,
    creatorEmail: r.creator_email || "",
    createdAt: r.created_at,
  }));
}

export async function declineInvite(token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("decline_invite", {
    invite_token: token,
  });
  if (error) {
    console.error("decline_invite RPC error:", error);
    return false;
  }
  const obj = (data ?? {}) as Record<string, any>;
  return obj.ok === true;
}

// ── Accept ────────────────────────────────────────────────────────

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
  | "email-mismatch"
  | "write-failed";

/**
 * Accept an invite as the signed-in user. Delegates to the server-
 * side `accept_invite` SQL RPC because RLS prevents the invitee
 * from reading the creator's project row (they are not yet the
 * collaborator). The RPC runs SECURITY DEFINER, enforces the
 * invite/ownership/email rules internally, and wires both rows.
 */
export async function acceptInvite(
  token: string,
  _accepterUserId?: string,
): Promise<AcceptResult | AcceptError> {
  const { data, error } = await supabase.rpc("accept_invite", {
    invite_token: token,
  });
  if (error) {
    console.error("accept_invite RPC error:", error);
    return "write-failed";
  }
  if (!data) return "write-failed";

  const obj = data as Record<string, any>;
  if (obj.error) {
    const err = obj.error as string;
    const known: AcceptError[] = [
      "not-found", "already-used", "self-accept",
      "project-full", "project-missing", "email-mismatch", "write-failed",
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
 * Build the shareable URL for an invite token. Used as a fallback
 * when email-based discovery doesn't work for the invitee.
 */
export function buildInviteUrl(token: string): string {
  if (typeof window === "undefined") return `/accept-invite/${token}`;
  return `${window.location.origin}/accept-invite/${token}`;
}

/**
 * Get the partner's email for a shared project. Drives the initials
 * chip next to every draft picker on the partner's side. Returns null
 * when the project isn't shared or the RPC can't resolve the partner.
 *
 * Backed by the get_partner_email SECURITY DEFINER RPC so we don't
 * need to expose auth.users to client SELECTs.
 */
export async function getPartnerEmail(projectId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_partner_email", {
    project_id: projectId,
  });
  if (error) {
    console.error("get_partner_email RPC error:", error);
    return null;
  }
  if (typeof data === "string" && data.length > 0) return data;
  return null;
}

/** Stable creator/invitee pair for a shared project. Powers the
 *  overlapping-initials indicator on every layer bar so both users
 *  see the same ordering (creator left, invitee right). Resolved
 *  from project_invites, so `invitee.email` is available even when
 *  the invitee hasn't accepted yet. */
export interface ProjectMembers {
  creator: { userId: string; email: string | null };
  invitee: { userId: string | null; email: string | null };
}

export async function getProjectMembers(
  projectId: string,
): Promise<ProjectMembers | null> {
  const { data, error } = await supabase.rpc("get_project_members", {
    project_id: projectId,
  });
  if (error) {
    console.error("get_project_members RPC error:", error);
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as any;
  if (!obj.creator || !obj.invitee) return null;
  return {
    creator: {
      userId: obj.creator.userId ?? "",
      email: obj.creator.email ?? null,
    },
    invitee: {
      userId: obj.invitee.userId ?? null,
      email: obj.invitee.email ?? null,
    },
  };
}
