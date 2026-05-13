-- Storage buckets for character + scene thumbnails. Run ONCE in the
-- Supabase SQL editor.
--
-- Why this exists: thumbnails used to live inline as base64 data URLs
-- inside the projects.data JSONB column. That made every project row
-- 1-2MB+ for a populated cast/script, which silently exceeded
-- Supabase upload limits and caused autosaves to be rejected. After
-- this migration, thumbnails live in dedicated public-read buckets
-- and the project row stays small.
--
-- Buckets:
--   character-images  → 5MB JPEG/PNG/WebP, public read
--   scene-images      → 5MB JPEG/PNG/WebP, public read
--
-- Reads: anyone with the URL can fetch (URLs are unguessable random
--        UUIDs, same security model as imgur user uploads).
-- Writes: server-side only via SUPABASE_SERVICE_ROLE_KEY (admin
--         bypasses RLS). The anon client cannot write.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('character-images', 'character-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('scene-images',     'scene-images',     true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public SELECT — any user (including anon) can read objects in
-- these two buckets. Required so the public URL renders in <img src>.
DROP POLICY IF EXISTS "Public read character-images" ON storage.objects;
CREATE POLICY "Public read character-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'character-images');

DROP POLICY IF EXISTS "Public read scene-images" ON storage.objects;
CREATE POLICY "Public read scene-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'scene-images');

-- No INSERT/UPDATE/DELETE policy — service role bypasses RLS, anon
-- clients cannot write. If the app ever needs client-side uploads,
-- add a targeted INSERT policy here (e.g. requiring auth.role() = 'authenticated').
