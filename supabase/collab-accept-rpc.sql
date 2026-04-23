-- Migration: server-side accept_invite RPC.
-- Run this in Supabase Dashboard → SQL Editor AFTER collab-schema.sql.
--
-- Why this exists:
--   RLS on `projects` says you can SELECT a row when you are the row's
--   user_id OR its collaborator_user_id. At the moment an invitee
--   tries to accept, they are neither — we're about to MAKE them the
--   collaborator, but until that write happens they can't read the
--   creator's row. Chicken-and-egg.
--
--   Rather than loosening RLS (which would let any signed-in user
--   read any project), we run the entire acceptance flow inside a
--   SECURITY DEFINER function. The function executes with the
--   privileges of the database owner, so it can read + write freely,
--   but the checks inside the function enforce the same rules:
--     * invite must exist and be unused
--     * accepter can't be the creator
--     * project can't already be paired with someone else

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

  -- 4. Seed the invitee's own row with a minimal Story shell. Only
  --    title / projectType / thumbnail are carried forward so the
  --    dashboard card renders nicely. All drafts start blank; the
  --    client's normalizeStory() turns a bare {id,title,projectType}
  --    into a fresh single-draft project on load (legacy Shape 3).
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

-- Every signed-in user can call this function; the internal checks
-- decide whether the call succeeds.
grant execute on function public.accept_invite(text) to authenticated;
