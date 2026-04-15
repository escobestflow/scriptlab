-- Run this in your Supabase Dashboard → SQL Editor → New Query → paste → Run

-- Projects table
create table if not exists projects (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  data jsonb not null default '{}',
  thumbnail text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Moments table
create table if not exists moments (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  data jsonb not null default '{}',
  created_at timestamptz default now()
);

-- Row Level Security: users can only see their own data
alter table projects enable row level security;
alter table moments enable row level security;

-- Policies for projects
create policy "Users can view own projects" on projects
  for select using (auth.uid() = user_id);
create policy "Users can insert own projects" on projects
  for insert with check (auth.uid() = user_id);
create policy "Users can update own projects" on projects
  for update using (auth.uid() = user_id);
create policy "Users can delete own projects" on projects
  for delete using (auth.uid() = user_id);

-- Policies for moments
create policy "Users can view own moments" on moments
  for select using (auth.uid() = user_id);
create policy "Users can insert own moments" on moments
  for insert with check (auth.uid() = user_id);
create policy "Users can update own moments" on moments
  for update using (auth.uid() = user_id);
create policy "Users can delete own moments" on moments
  for delete using (auth.uid() = user_id);
