-- Phase 2 collab: expose partner email for avatar chips.
--
-- The UI renders a circular initials chip next to every per-layer draft
-- picker and next to the project-draft dropdown, on both the user's
-- own side and the partner's side, so you can tell at a glance whose
-- drafts you're browsing. Generating the partner's initial requires
-- reading their email, which lives in auth.users. Direct client-side
-- SELECT on auth.users is blocked (and should be), so we expose it
-- through a narrow SECURITY DEFINER RPC scoped to "my collaborator
-- on this project":
--
--   1. Verify the caller is a member of the project (they must own at
--      least one row with this project_id).
--   2. Return the email of the OTHER user who also owns a row for the
--      same project_id.
--
-- Returns NULL when the project isn't shared, when the caller isn't a
-- member, or when the partner's auth.users row is missing for any
-- reason. The UI falls back to a generic initial when NULL comes back.

create or replace function public.get_partner_email(project_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := auth.uid();
  partner   uuid;
  em        text;
begin
  if me is null then
    return null;
  end if;
  -- Confirm I'm a member: I own a row for this project_id.
  perform 1 from projects p
    where p.id = project_id and p.user_id = me;
  if not found then
    return null;
  end if;
  -- Find the OTHER owner.
  select p.user_id into partner
    from projects p
    where p.id = project_id and p.user_id <> me
    limit 1;
  if partner is null then
    return null;
  end if;
  select u.email into em from auth.users u where u.id = partner;
  return em;
end;
$$;

grant execute on function public.get_partner_email(text) to authenticated;
