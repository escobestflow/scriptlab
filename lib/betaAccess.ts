// Beta allowlist. Single source of truth for who can use the app
// during beta. Read from NEXT_PUBLIC_ALLOWED_EMAILS so the same list
// works on both the client (immediate sign-out for unauthorized
// users) and the server (403 on every paid API route).
//
// The env var is bundled into the client at build time, so updating
// the list requires editing .env.local (dev) or the hosting provider's
// env vars (prod) and restarting/redeploying — no DB migration.
//
// Empty / unset means "no gating" — every authenticated user is let
// through. Useful for local dev when you don't want to constantly
// fight the allowlist.

export const ALLOWED_EMAILS: string[] = (process.env.NEXT_PUBLIC_ALLOWED_EMAILS ?? "")
  .split(",")
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

/** True when the allowlist is empty (no gating) or the email is on it.
 *  Case-insensitive. Falsy emails always return false. */
export function isBetaAllowed(email: string | null | undefined): boolean {
  if (ALLOWED_EMAILS.length === 0) return true;
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}

/** Standard 403 response body for API routes blocking a non-allowed
 *  caller. Centralized so the wording stays consistent across routes. */
export const BETA_FORBIDDEN_RESPONSE = {
  status: 403,
  body: {
    error: "beta-access-required",
    message: "This account isn't on the beta allowlist. Contact the project owner to request access.",
  },
};
