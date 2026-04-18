-- Writer Profile table — one row per authenticated user.
-- Stores a JSONB blob of cumulative creative-preference signals and
-- prose-style metrics. See lib/writerProfile.ts for the shape.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.writer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.writer_profiles enable row level security;

-- Each user reads / writes their own row only.
create policy "writer_profiles select own"
  on public.writer_profiles for select
  using (auth.uid() = user_id);

create policy "writer_profiles insert own"
  on public.writer_profiles for insert
  with check (auth.uid() = user_id);

create policy "writer_profiles update own"
  on public.writer_profiles for update
  using (auth.uid() = user_id);

create policy "writer_profiles delete own"
  on public.writer_profiles for delete
  using (auth.uid() = user_id);
