-- Phase 2 collab: enable realtime on the projects table.
--
-- The Studio subscribes to changes on the partner's row via
-- supabase.channel().on("postgres_changes", ...) so the user sees
-- their partner's saves ripple into the partner-draft dropdown
-- without a manual reload. For those change events to actually be
-- broadcast, the `projects` table must be in the supabase_realtime
-- publication. New Supabase projects include this publication by
-- default; adding the table is idempotent via the DO block below
-- so running this twice is safe.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;
