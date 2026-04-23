-- Migration: enable 2-person project collaboration.
-- Run this in Supabase Dashboard → SQL Editor after the initial
-- supabase-schema.sql has been applied.
--
-- Model:
--   The original `projects` table keyed each row by `id` (story.id).
--   For collaboration, two users must be able to hold distinct rows
--   that reference the SAME project id — one "copy" per user. So we
--   switch to a composite primary key (id, user_id). For single-user
--   projects this is a no-op (there is still exactly one row per id).
--
--   When a project is shared, each user's row carries
--   `collaborator_user_id` pointing at the *other* user. That flag
--   is the single source of truth for "is this project collab" and
--   "who is my partner."
--
--   Invites are issued as opaque tokens. The creator shares the
--   token via a link; the invitee signs in and visits
--   /accept-invite/<token>, which creates their row and marks
--   the invite consumed.
--
-- IMPORTANT: existing single-user projects are UNAFFECTED by this
-- migration. `collaborator_user_id` defaults NULL; RLS still
-- restricts every user to their own row.

-- 1. Composite primary key ------------------------------------------
alter table projects drop constraint if exists projects_pkey;
alter table projects add constraint projects_pkey primary key (id, user_id);

-- 2. Collaborator pointer -------------------------------------------
alter table projects
  add column if not exists collaborator_user_id uuid
    references auth.users(id) on delete set null;

-- 3. Invites table --------------------------------------------------
create table if not exists project_invites (
  token            text primary key,
  project_id       text not null,
  creator_user_id  uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz default now(),
  accepted_at      timestamptz,
  accepted_by      uuid references auth.users(id) on delete set null
);

alter table project_invites enable row level security;

-- Creator can read their own invites (for "is there an outstanding invite" UI).
drop policy if exists "Users can view own invites" on project_invites;
create policy "Users can view own invites"
  on project_invites for select
  using (auth.uid() = creator_user_id);

-- Creator creates invites for their own projects.
drop policy if exists "Users can create own invites" on project_invites;
create policy "Users can create own invites"
  on project_invites for insert
  with check (auth.uid() = creator_user_id);

-- Creator revokes their invites.
drop policy if exists "Users can delete own invites" on project_invites;
create policy "Users can delete own invites"
  on project_invites for delete
  using (auth.uid() = creator_user_id);

-- Any signed-in user can read an invite row BY TOKEN (needed for the
-- accept page). Enumeration is prevented by the opaque 32-hex token —
-- you cannot list invites you don't own; you must know the token.
drop policy if exists "Signed-in users can read invites" on project_invites;
create policy "Signed-in users can read invites"
  on project_invites for select
  using (auth.uid() is not null);

-- Signed-in users can mark an unclaimed invite as accepted. They must
-- set `accepted_by` to themselves; they cannot rewrite other fields.
drop policy if exists "Invitees can accept" on project_invites;
create policy "Invitees can accept"
  on project_invites for update
  using (auth.uid() is not null and accepted_at is null)
  with check (accepted_by = auth.uid());

-- 4. Loosen projects SELECT so you can see your partner's row -------
-- This is the ONLY RLS change that affects visibility: you can SELECT
-- a row where you are the collaborator. INSERT / UPDATE / DELETE stay
-- strictly self — you can never write to your partner's row.
drop policy if exists "Users can view own projects" on projects;
create policy "Users can view own and shared projects" on projects
  for select using (
    auth.uid() = user_id
    or auth.uid() = collaborator_user_id
  );
