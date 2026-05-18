// Hardcoded admin allowlist for the /admin/usage dashboard. Kept in a
// dependency-free module so both the client (page-level gate) and the
// server (route-level gate in /api/admin/usage) can import it without
// pulling in Supabase or other server-only modules.
//
// Per spec: "Only I should ever be admin." Update this set if that
// ever changes.

const ADMIN_EMAILS = new Set([
  "luisfescobarjr@gmail.com",
]);

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase());
}

// The two emails that are EXPECTED to drive most usage. Anyone else in
// the dashboard gets a "non-trusted" badge so unexpected usage jumps
// out. Not an authorization check — purely a UI hint.
const TRUSTED_EMAILS = new Set([
  "luisfescobarjr@gmail.com",
  "michaeltegues@gmail.com",
]);

export function isTrusted(email: string | null | undefined): boolean {
  if (!email) return false;
  return TRUSTED_EMAILS.has(email.toLowerCase());
}
