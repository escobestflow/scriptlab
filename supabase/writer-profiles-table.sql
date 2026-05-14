-- Writer profile per user. One JSONB blob per row, keyed by user_id.
-- Run ONCE in the Supabase SQL editor. Safe to re-run (uses IF NOT
-- EXISTS / DROP POLICY IF EXISTS).
--
-- The app's `lib/writerProfileStore.ts` was already calling this
-- table (`loadWriterProfileFromDB` / `saveWriterProfileToDB`) but
-- the table didn't exist in the project's Supabase, causing every
-- profile load/save to fail with PGRST205 ("Perhaps you meant the
-- table 'public.profiles'"). That's the source of the
-- `[writer-profile] save error` lines flooding the console.
-- Creating the table makes the error stop and the writer-profile
-- machinery actually work.

CREATE TABLE IF NOT EXISTS writer_profiles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per user (PRIMARY KEY on user_id already enforces this).
-- An index on updated_at lets us audit recently-active users without
-- a full table scan if we ever need to.
CREATE INDEX IF NOT EXISTS writer_profiles_updated_at_idx
  ON writer_profiles (updated_at DESC);

-- Row-level security: users can ONLY read/write their own row.
-- The service-role key bypasses these — server-side admin operations
-- (e.g. background sync, support tooling) are unaffected.
ALTER TABLE writer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own writer_profile" ON writer_profiles;
CREATE POLICY "Users read own writer_profile"
  ON writer_profiles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own writer_profile" ON writer_profiles;
CREATE POLICY "Users insert own writer_profile"
  ON writer_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own writer_profile" ON writer_profiles;
CREATE POLICY "Users update own writer_profile"
  ON writer_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own writer_profile" ON writer_profiles;
CREATE POLICY "Users delete own writer_profile"
  ON writer_profiles FOR DELETE
  USING (auth.uid() = user_id);
