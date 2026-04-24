-- Phase 2 collab: resolve both participants of a shared project in a
-- stable creator/invitee order.
--
-- The initials-pair indicator on every layer bar needs to show the
-- CREATOR on the left and the INVITED collaborator on the right, the
-- same way for both sides — so a simple "me + partner" pair isn't
-- enough (each side would put themselves on the left otherwise).
--
-- project_invites already carries everything we need:
--   - creator_user_id  → always the project creator
--   - invitee_email    → the email the invite was bound to
--   - accepted_by      → the invitee's auth.users.id once they accept
--
-- So we pick the most relevant invite for the project (accepted first,
-- newest otherwise), join auth.users for the creator's email, and
-- return jsonb:
--   { creator: { userId, email }, invitee: { userId|null, email } }
--
-- Returns NULL if the caller isn't a project member (own row or
-- collaborator row). SECURITY DEFINER so we can read auth.users.

create or replace function public.get_project_members(project_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me               uuid := auth.uid();
  inv              record;
  creator_email    text;
  invitee_email    text;
  invitee_user_id  uuid;
begin
  if me is null then
    return null;
  end if;

  -- Caller must be a member (owner or collaborator) of the project.
  perform 1 from projects p
    where p.id = get_project_members.project_id
      and (p.user_id = me or p.collaborator_user_id = me);
  if not found then
    return null;
  end if;

  -- Pick the most relevant invite: accepted-first, newest-otherwise.
  -- A project may in principle have multiple invites (e.g., creator
  -- re-invited) but at most one accepted invite — that's the one
  -- that defines the current pair.
  select * into inv
    from project_invites
    where project_id = get_project_members.project_id
    order by (accepted_at is not null) desc, created_at desc
    limit 1;
  if not found then
    return null;
  end if;

  select email into creator_email
    from auth.users where id = inv.creator_user_id;

  if inv.accepted_by is not null then
    select email into invitee_email
      from auth.users where id = inv.accepted_by;
    invitee_user_id := inv.accepted_by;
  else
    -- Pending invite — email comes from the invite row itself.
    invitee_email := inv.invitee_email;
    invitee_user_id := null;
  end if;

  return jsonb_build_object(
    'creator', jsonb_build_object(
      'userId', inv.creator_user_id,
      'email',  creator_email
    ),
    'invitee', jsonb_build_object(
      'userId', invitee_user_id,
      'email',  invitee_email
    )
  );
end;
$$;

grant execute on function public.get_project_members(text) to authenticated;
