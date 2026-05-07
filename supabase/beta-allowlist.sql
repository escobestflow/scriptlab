-- Beta allowlist — DB-level gate that blocks new account creation
-- for any email not on the list. Layered on top of:
--   - the client-side gate in lib/auth.tsx (immediate sign-out + UI message)
--   - the server-side gate on every paid /api/* route (403)
-- This is the third layer: stops the auth.users row from existing
-- in the first place, so unauthorized users can't even hold a session.
--
-- Run this once in the Supabase SQL editor. Updating the allowlist
-- afterwards is a regular INSERT/DELETE on public.beta_allowlist.
-- Existing users in auth.users are NOT affected — the trigger only
-- fires on INSERT (new account creation).

-- ── Allowlist table ──────────────────────────────────────────────
-- Email is the primary key, lowercased on insert via a CHECK
-- constraint so the trigger's lookup never has to wonder about case.
create table if not exists public.beta_allowlist (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now(),
  -- Optional free-text note for context (who added them, why, etc.).
  -- Helpful when you come back in three months and don't remember.
  note       text
);

-- ── RLS lockdown ─────────────────────────────────────────────────
-- The list itself is sensitive (17 personal emails). Lock it down
-- to the service role only. Regular authenticated users can't read,
-- insert, update, or delete. The trigger function below runs as
-- SECURITY DEFINER so it bypasses RLS regardless.
alter table public.beta_allowlist enable row level security;

-- Drop any prior policies (idempotent re-runs)
drop policy if exists "beta_allowlist no select"   on public.beta_allowlist;
drop policy if exists "beta_allowlist no insert"   on public.beta_allowlist;
drop policy if exists "beta_allowlist no update"   on public.beta_allowlist;
drop policy if exists "beta_allowlist no delete"   on public.beta_allowlist;

-- Empty policy set + RLS enabled = everyone except service role is
-- denied. (Postgres default-deny when RLS is on.) No explicit policies
-- needed; the comment above is the documentation.

-- ── Trigger function ─────────────────────────────────────────────
-- Fires before every INSERT into auth.users. If the inserted email
-- isn't in the allowlist, raise — Supabase Auth surfaces the error
-- back to the client as a sign-in failure, the auth.users row is
-- never committed, and no row exists to clean up.
--
-- SECURITY DEFINER + explicit search_path so this runs with the
-- function-creator's privileges (postgres) and can't be tricked by
-- a poisoned search_path. SECURITY DEFINER means RLS doesn't apply
-- to the SELECT below — important since we locked the table down.
--
-- "Empty list = no gating" branch: if the allowlist is empty, every
-- email passes. Useful for local dev (different Supabase project)
-- where you don't want to bother seeding the table.
create or replace function public.enforce_beta_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_count int;
begin
  v_email := lower(coalesce(new.email, ''));

  -- Empty list ⇒ no gating.
  select count(*) into v_count from public.beta_allowlist;
  if v_count = 0 then
    return new;
  end if;

  -- Email on the list ⇒ allow.
  if exists (select 1 from public.beta_allowlist where email = v_email) then
    return new;
  end if;

  -- Otherwise block. The error code "beta-access-required" is
  -- machine-readable; the message is human-readable for logs.
  raise exception 'beta-access-required: % is not on the beta allowlist', v_email
    using errcode = 'P0001';
end;
$$;

-- Idempotent install — drop first so re-running this script is safe.
drop trigger if exists enforce_beta_allowlist_before_insert on auth.users;

create trigger enforce_beta_allowlist_before_insert
  before insert on auth.users
  for each row
  execute function public.enforce_beta_allowlist();

-- ── Seed ─────────────────────────────────────────────────────────
-- Insert the current beta cohort. ON CONFLICT DO NOTHING means
-- re-running the script is idempotent — adding new emails is just
-- another INSERT, removing them is a DELETE.
insert into public.beta_allowlist (email, note) values
  ('anasalazar1206@gmail.com',     'beta cohort 1'),
  ('bogboss1599@gmail.com',        'beta cohort 1'),
  ('carolinehilton97@gmail.com',   'beta cohort 1'),
  ('claude-dev@unfold.dev',        'claude dev preview — local testing'),
  ('ldeoliveiranyc@gmail.com',     'beta cohort 1'),
  ('leylakhotanzad@gmail.com',     'beta cohort 1'),
  ('luis@unfold.dev',              'beta cohort 1'),
  ('luisfescobarjr@gmail.com',     'beta cohort 1'),
  ('mariagogliafischer@gmail.com', 'beta cohort 1'),
  ('michaeltegues@gmail.com',      'beta cohort 1'),
  ('mrvicinityla@gmail.com',       'beta cohort 1'),
  ('rayhodjatcd@gmail.com',        'beta cohort 1'),
  ('rodrigotpaiva@gmail.com',      'beta cohort 1'),
  ('roohi.r.ebrahim@gmail.com',    'beta cohort 1'),
  ('sam@unfold.dev',               'beta cohort 1'),
  ('samuelliebermanuel@gmail.com', 'beta cohort 1'),
  ('scobro78@gmail.com',           'beta cohort 1'),
  ('welldvlpd@gmail.com',          'beta cohort 1')
on conflict (email) do nothing;
