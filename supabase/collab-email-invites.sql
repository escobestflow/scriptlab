-- Migration: email-addressed invites + in-dashboard accept/decline.
-- Run this in Supabase Dashboard → SQL Editor AFTER both
-- collab-schema.sql and collab-accept-rpc.sql have been applied.
--
-- What changes:
--   * project_invites gains an `invitee_email` column. When set, the
--     invite is bound to that email — only the user whose JWT email
--     matches can accept. The token-URL flow still works for invites
--     created without an email.
--   * New RLS policy: signed-in users can SELECT invites addressed
--     to their email. This lets the dashboard query "invites for me"
--     directly.
--   * Updated accept_invite RPC: verifies email match when
--     invitee_email is non-null. Returns a new "email-mismatch"
--     error when the signed-in user isn't the invited email.
--   * New list_my_pending_invites() RPC: returns enriched invite
--     rows (title + thumbnail joined from the creator's project,
--     creator's email joined from auth.users) so the dashboard
--     can render project cards with Accept / Decline buttons.
--   * New decline_invite(token) RPC: lets the invitee reject the
--     invite (deletes the invite row).

-- 1. Add invitee_email column --------------------------------------
alter table project_invites
  add column if not exists invitee_email text;

create index if not exists project_invites_invitee_email_idx
  on project_invites (lower(invitee_email))
  where invitee_email is not null;

-- 2. RLS: invitee can see invites addressed to their email --------
drop policy if exists "Invitees can see own invites by email" on project_invites;
create policy "Invitees can see own invites by email"
  on project_invites for select
  using (
    auth.uid() is not null
    and invitee_email is not null
    and lower(invitee_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- 3. Replace accept_invite to verify email binding ----------------
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

  -- 1. Find invite.
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

  -- 1a. If the invite is email-bound, the signed-in user's email
  --     MUST match. This is what prevents someone who stumbles on
  --     the token URL from hijacking an invite addressed to someone else.
  if inv.invitee_email is not null then
    accepter_em := lower(coalesce(auth.jwt() ->> 'email', ''));
    if accepter_em = '' or lower(inv.invitee_email) <> accepter_em then
      return jsonb_build_object('error', 'email-mismatch');
    end if;
  end if;

  -- 2. Find creator's project row.
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

  -- 3. Mark the creator's row as shared with the accepter.
  update projects
    set collaborator_user_id = accepter,
        updated_at = now_ts
    where id = inv.project_id and user_id = inv.creator_user_id;

  -- 4. Seed the invitee's own row.
  seed_data := jsonb_build_object(
    'id',          inv.project_id,
    'title',       coalesce(creator_row.data->>'title', ''),
    'projectType', coalesce(creator_row.data->>'projectType', 'feature')
  );
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

  -- 5. Consume the invite.
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

-- 4. decline_invite ------------------------------------------------
create or replace function public.decline_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv          record;
  me           uuid := auth.uid();
  my_em        text;
begin
  if me is null then
    return jsonb_build_object('error', 'not-authenticated');
  end if;
  select * into inv from project_invites where token = invite_token;
  if not found then
    return jsonb_build_object('error', 'not-found');
  end if;
  if inv.accepted_at is not null then
    return jsonb_build_object('error', 'already-used');
  end if;
  -- Only the named invitee can decline; the creator revokes via the
  -- separate revoke_invite DELETE path.
  if inv.invitee_email is null then
    return jsonb_build_object('error', 'not-invitee');
  end if;
  my_em := lower(coalesce(auth.jwt() ->> 'email', ''));
  if my_em = '' or lower(inv.invitee_email) <> my_em then
    return jsonb_build_object('error', 'not-invitee');
  end if;
  delete from project_invites where token = invite_token;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.decline_invite(text) to authenticated;

-- 5. list_my_pending_invites --------------------------------------
-- Returns invites addressed to the signed-in user's email that are
-- not yet accepted, joined with the inviting project's title /
-- thumbnail / projectType and the creator's email.
create or replace function public.list_my_pending_invites()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  my_em    text;
  result   jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  my_em := lower(coalesce(auth.jwt() ->> 'email', ''));
  if my_em = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) into result
  from (
    select
      i.token                                           as token,
      i.project_id                                      as project_id,
      i.created_at                                      as created_at,
      i.creator_user_id                                 as creator_user_id,
      coalesce(u.email, '')                             as creator_email,
      coalesce(p.data ->> 'title', '')                  as project_title,
      coalesce(p.data ->> 'projectType', 'feature')     as project_type,
      p.thumbnail                                       as project_thumbnail
    from project_invites i
    left join projects p
      on p.id = i.project_id and p.user_id = i.creator_user_id
    left join auth.users u
      on u.id = i.creator_user_id
    where i.accepted_at is null
      and i.invitee_email is not null
      and lower(i.invitee_email) = my_em
    order by i.created_at desc
  ) r;

  return result;
end;
$$;

grant execute on function public.list_my_pending_invites() to authenticated;
