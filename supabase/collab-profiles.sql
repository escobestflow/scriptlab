-- Phase 2 collab: user profiles (just a display name, for now).
--
-- Why we need this: on shared projects the overlapping-initials chip
-- on each layer bar renders a first letter for each participant. That
-- letter is derived from the user's email by default, which is fine
-- for solo use but fragile for collab — two invitees with emails
-- starting with the same letter collide, and the letter can feel
-- impersonal.
--
-- So on entering a shared project, the UI prompts each participant
-- for a first name and stores it here. The initials chip prefers the
-- name's first letter over the email's first letter once available.
--
-- Design:
--   * One row per auth user (user_id is the primary key).
--   * Readable by any authenticated caller so each side can render
--     the *partner's* initial, not just their own.
--   * Writable only by the owner — no cross-user edits.
--   * get_project_members (from collab-project-members.sql) is
--     updated below to include each side's display_name, so the
--     client gets the name in the same payload it already fetches.

-- 1. profiles table ---------------------------------------------------
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  email         text,
  updated_at    timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles readable by authenticated" on public.profiles;
create policy "Profiles readable by authenticated"
  on public.profiles for select
  using (auth.uid() is not null);

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Update get_project_members to include display_name ---------------
-- Identical resolution logic to collab-project-members.sql — the only
-- change is that each side's jsonb now carries a `displayName` field
-- pulled from profiles (null when the user hasn't set one yet).
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
  creator_name     text;
  invitee_email    text;
  invitee_user_id  uuid;
  invitee_name     text;
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
    from project_invites
    where project_id = get_project_members.project_id
    order by (accepted_at is not null) desc, created_at desc
    limit 1;
  if not found then
    return null;
  end if;

  select email into creator_email
    from auth.users where id = inv.creator_user_id;
  select display_name into creator_name
    from profiles where user_id = inv.creator_user_id;

  if inv.accepted_by is not null then
    select email into invitee_email
      from auth.users where id = inv.accepted_by;
    invitee_user_id := inv.accepted_by;
    select display_name into invitee_name
      from profiles where user_id = inv.accepted_by;
  else
    invitee_email := inv.invitee_email;
    invitee_user_id := null;
    invitee_name := null;
  end if;

  return jsonb_build_object(
    'creator', jsonb_build_object(
      'userId',      inv.creator_user_id,
      'email',       creator_email,
      'displayName', creator_name
    ),
    'invitee', jsonb_build_object(
      'userId',      invitee_user_id,
      'email',       invitee_email,
      'displayName', invitee_name
    )
  );
end;
$$;

grant execute on function public.get_project_members(text) to authenticated;
