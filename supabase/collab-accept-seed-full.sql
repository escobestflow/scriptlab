-- Migration: accept_invite now seeds the invitee's row with the FULL
-- snapshot of the creator's data + thumbnail, instead of just
-- {id, title, projectType}. Run this in Supabase Dashboard → SQL
-- Editor AFTER collab-email-invites.sql has been applied.
--
-- Why:
--   Before this change the invitee's own projects row was a near-
--   empty seed — id + title + projectType + thumbnail + the two
--   user-id fields. Everything else (logline, conceptDrafts,
--   charactersDrafts, storyDrafts, scriptDrafts, projectDrafts, …)
--   was blank, so the dashboard had to reach across to the creator
--   via a separate loadPartnerProjectData() call JUST to render the
--   invitee's project card with a logline. That cross-fetch was
--   async, cache-sensitive, and re-ran on every dashboard hydration
--   / Studio re-entry / page reload — users watched the logline
--   disappear and reappear.
--
--   After this change the invitee's row carries the creator's full
--   `data` payload and `thumbnail` at accept time. The invitee owns
--   their copy from day one: dashboard card renders from local
--   storage, no partner fetch needed. The two rows diverge from
--   there — each user's subsequent edits save only to their own row.
--
--   We still expose the partner's Story inside Studio (for the
--   "Partner's drafts" picker in the Whose Drafts sheet), but that's
--   a Studio-scoped fetch, not a dashboard-critical one.
--
-- Protected fields rule preserved:
--   Title + projectType still come from the creator (they were
--   captured at project creation and are the project's identity).
--   Genres + everything else now ride along inside the copied data
--   payload — same as the creator has them today.

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
  accepter_em   text;
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

  -- 1a. Email-binding check (unchanged from collab-email-invites.sql).
  if inv.invitee_email is not null then
    accepter_em := lower(coalesce(auth.jwt() ->> 'email', ''));
    if accepter_em = '' or lower(inv.invitee_email) <> accepter_em then
      return jsonb_build_object('error', 'email-mismatch');
    end if;
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

  -- 4. Seed the invitee's own row with the FULL creator payload.
  --    Previously this was a minimal stub ({id,title,projectType});
  --    now we clone the creator's entire `data` jsonb so the invitee
  --    starts with a real project — logline, all drafts, everything.
  --    We only override `id` to guarantee the copy's id still matches
  --    the shared project id (defensive; creator's data already
  --    carries it, but we want to be sure).
  seed_data := coalesce(creator_row.data, '{}'::jsonb)
               || jsonb_build_object('id', inv.project_id);

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
    -- If the invitee already has a row (somehow), don't clobber their
    -- data — just make sure the collaborator link is set. The full-
    -- seed only applies to net-new rows; an existing row means the
    -- user already has their own content and we must not overwrite.
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

grant execute on function public.accept_invite(text) to authenticated;
