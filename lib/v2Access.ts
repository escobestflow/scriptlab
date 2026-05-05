// V2 redesign / feature allowlist. Controls who sees the v2 design AND
// who gets routed to v2-only paid features (e.g. the upgraded
// gpt-image-2 thumbnail model). Read from NEXT_PUBLIC_V2_EMAILS so the
// same list works on both the client (data-design attribute) and the
// server (per-request feature routing).
//
// Empty / unset = no v2 users. Useful for local dev when you don't
// want to bother seeding the list.

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
