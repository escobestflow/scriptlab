-- Usage logging — one row per AI provider call (Anthropic / OpenAI).
-- Powers the /admin/usage dashboard so the user can see at any time
-- WHO is generating WHAT, the model used, raw counts, and an estimated
-- USD cost. Failures are logged too (with `error` populated) — that's
-- how a leaked API key would have shown up early.
--
-- Run this once in the Supabase SQL editor. Re-running is idempotent:
-- the CREATE TABLE / CREATE INDEX statements all use IF NOT EXISTS,
-- the policies are dropped before recreated.

-- ── Table ────────────────────────────────────────────────────────
create table if not exists public.usage_log (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  -- Caller identity. user_id is the canonical reference; email is
  -- denormalized so the admin dashboard can render without an
  -- auth.users JOIN (and so rows survive a user deletion for audit).
  user_id         uuid references auth.users(id) on delete set null,
  user_email      text not null,

  -- What project the call was made against. Optional because some
  -- routes (e.g. /api/convert-notes used in the create-project flow)
  -- don't yet have a project at call time.
  project_id      uuid,

  -- Provider + model. `provider` is one of: 'anthropic', 'openai'.
  -- `kind` is the call category: 'text', 'image', 'audio'.
  provider        text not null,
  kind            text not null,
  model           text not null,

  -- The semantic action the user took, in our app's vocabulary.
  -- E.g. 'generate_beats', 'sync_story_to_script', 'tts',
  -- 'generate_character_image', 'generate_thumbnail'. Bigger
  -- bucket than `model` — multiple actions can share a model.
  action          text not null,

  -- Provider-specific counts. Only the ones relevant to `kind`
  -- will be populated; the rest stay NULL.
  input_tokens                 integer,
  output_tokens                integer,
  cache_creation_input_tokens  integer,
  cache_read_input_tokens      integer,
  image_count                  integer,
  image_size                   text,    -- '1024x1024', '1792x1024', '1024x1792'
  audio_chars                  integer,

  -- Estimated USD cost computed at log time from lib/usageLog.ts's
  -- pricing table. Stored (not just computed on read) so historical
  -- numbers don't shift when pricing changes mid-quarter.
  est_cost_usd    numeric(10, 6),

  -- Populated only when the upstream call failed. Surface in the
  -- dashboard so 4xx/5xx storms are visible.
  error           text
);

-- ── Indexes ──────────────────────────────────────────────────────
-- Dashboard queries are: recent rows (time desc), filter by user,
-- filter by action, daily aggregates by user. Cover the common ones.
create index if not exists usage_log_created_at_desc_idx
  on public.usage_log (created_at desc);
create index if not exists usage_log_user_email_created_at_idx
  on public.usage_log (user_email, created_at desc);
create index if not exists usage_log_action_idx
  on public.usage_log (action);
create index if not exists usage_log_project_id_idx
  on public.usage_log (project_id);

-- ── RLS ──────────────────────────────────────────────────────────
-- Service role bypasses RLS (used by API routes to INSERT). Regular
-- authenticated users are denied SELECT / INSERT / UPDATE / DELETE
-- across the board — the admin dashboard reads via the service-role
-- client server-side, never directly from the browser.
alter table public.usage_log enable row level security;

drop policy if exists "usage_log no select" on public.usage_log;
drop policy if exists "usage_log no insert" on public.usage_log;
drop policy if exists "usage_log no update" on public.usage_log;
drop policy if exists "usage_log no delete" on public.usage_log;

-- Empty policy set + RLS enabled = default-deny for everyone except
-- the service role. The admin page hits the service-role client
-- server-side; it never reaches the browser auth context.
