// V2 redesign / feature allowlist. Controls who sees the v2 design AND
// who gets routed to v2-only paid features (e.g. the upgraded
// gpt-image-2 thumbnail model). Read from NEXT_PUBLIC_V2_EMAILS so the
// same list works on both the client (data-design attribute) and the
// server (per-request feature routing).
//
// Empty / unset = no v2 users. Useful for local dev when you don't
// want to bother seeding the list.

import { useAuth } from "./auth";

export const V2_EMAILS: string[] = (process.env.NEXT_PUBLIC_V2_EMAILS ?? "")
  .split(",")
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

/** True when the email is on the v2 allowlist. Falsy emails always
 *  return false (signed-out viewers and missing X-User-Email headers
 *  default to v1). Case-insensitive. */
export function isV2User(email: string | null | undefined): boolean {
  if (!email) return false;
  return V2_EMAILS.includes(email.toLowerCase());
}

/** Client-side hook for opt-in JSX branches that need to render v2
 *  markup. Pulls the current user's email out of the auth context and
 *  re-evaluates whenever auth state changes — same source of truth as
 *  the html[data-design] attribute, so CSS scoping and JSX branching
 *  stay in sync without extra subscriptions. */
export function useIsV2(): boolean {
  const { user } = useAuth();
  return isV2User(user?.email);
}
