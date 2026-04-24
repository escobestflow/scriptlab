-- Consolidated collab RPC fix.
--
-- Paste this file whole into Supabase Dashboard → SQL Editor and run
-- it once. It replaces three RPCs and backfills any existing empty-
-- seed invitee rows that were created by the OLD accept_invite.
--
-- What each section does:
--   1. accept_invite            — full-seed invitee row from creator's
--                                 data payload (fixes "no logline yet")
--   2. get_partner_email        — creates the RPC if missing
--   3. get_project_members      — fixes "column reference project_id is
--                                 ambiguous" by fully qualifying
--                                 every reference to the parameter
--   4. backfill                 — finds every invitee row whose data
--                                 looks like the empty-seed shape
--                                 (conceptDrafts[0].id == projectId)
--                                 and rewrites its data from the
--                                 matching creator row. Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────
-- 1. accept_invite — full-seed version.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.accept_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv           record;
  creator_row   record;
  accepter      uuid;
  accepter_em   text;
  now_ts        timestamptz := now();
  seed_data     jsonb;
begin
  accepter := auth.uid();
  if accepter is null then
    return jsonb_build_object('error', 'not-authenticated');
  end if;

  select * into inv from project_invites where token = invite_token;
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  if inv.accepted_at is not null then
    return jsonb_build_object('error', 'already-used');
  end if;
  if inv.creator_user_id = accepter then
    return jsonb_build_object('error', 'self-accept');
  end if;

  if inv.invitee_email is not null then
    accepter_em := lower(coalesce(auth.jwt() ->> 'email', ''));
    if accepter_em = '' or lower(inv.invitee_email) <> accepter_em then
      return jsonb_build_object('error', 'email-mismatch');
    end if;
  end if;

  select id, data, thumbnail, collaborator_user_id
    into creator_row
  from projects
  where id = inv.project_id and user_id = inv.creator_user_id;
  if not found then
    return jsonb_build_object('error', 'project-missing');
  end if;
  if creator_row.collaborator_user_id is not null
     and creator_row.collaborator_user_id <> accepter then
    return jsonb_build_object('error', 'project-full');
  end if;

  update projects
    set collaborator_user_id = accepter,
        updated_at = now_ts
    where id = inv.project_id and user_id = inv.creator_user_id;

  seed_data := coalesce(creator_row.data, '{}'::jsonb)
               || jsonb_build_object('id', inv.project_id);

  insert into projects (id, user_id, data, thumbnail, collaborator_user_id, updated_at)
  values (
    inv.project_id,
    accepter,
    seed_data,
    creator_row.thumbnail,
    inv.creator_user_id,
    now_ts
  )
  on conflict (id, user_id) do update set
    collaborator_user_id = excluded.collaborator_user_id,
    updated_at = now_ts;

  update project_invites
    set accepted_at = now_ts,
        accepted_by = accepter
    where token = invite_token;

  return jsonb_build_object(
    'projectId',     inv.project_id,
    'creatorUserId', inv.creator_user_id
  );
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 2. get_partner_email — create/replace.
-- ─────────────────────────────────────────────────────────────────────

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
  perform 1 from projects p
    where p.id = get_partner_email.project_id and p.user_id = me;
  if not found then
    return null;
  end if;
  select p.user_id into partner
    from projects p
    where p.id = get_partner_email.project_id and p.user_id <> me
    limit 1;
  if partner is null then
    return null;
  end if;
  select u.email into em from auth.users u where u.id = partner;
  return em;
end;
$$;

grant execute on function public.get_partner_email(text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 3. get_project_members — fix ambiguous `project_id`.
-- ─────────────────────────────────────────────────────────────────────

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

  perform 1 from projects p
    where p.id = get_project_members.project_id
      and (p.user_id = me or p.collaborator_user_id = me);
  if not found then
    return null;
  end if;

  select * into inv
    from project_invites pi
    where pi.project_id = get_project_members.project_id
    order by (pi.accepted_at is not null) desc, pi.created_at desc
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


-- ─────────────────────────────────────────────────────────────────────
-- 4. Backfill existing empty-seed invitee rows.
--
-- Finds every projects row where:
--   - there's a matching creator row (different user, same project id)
--   - the invitee's data has the old empty-seed shape (concept draft
--     id equals the project id — a placeholder, never a real draft id)
-- and rewrites the invitee's data from the creator's current data.
-- Thumbnail gets copied too. Safe to re-run; idempotent for already-
-- seeded rows because the where-clause filters those out.
-- ─────────────────────────────────────────────────────────────────────

update projects invitee
   set data = (coalesce(creator.data, '{}'::jsonb)
                || jsonb_build_object('id', invitee.id)),
       thumbnail = creator.thumbnail,
       updated_at = now()
  from projects creator
 where invitee.id = creator.id
   and invitee.user_id <> creator.user_id
   and invitee.collaborator_user_id = creator.user_id
   and creator.collaborator_user_id = invitee.user_id
   and (
         invitee.data->'conceptDrafts'->0->>'id' = invitee.id::text
      or (invitee.data->'conceptDrafts') is null
      or jsonb_array_length(coalesce(invitee.data->'conceptDrafts', '[]'::jsonb)) = 0
   );
