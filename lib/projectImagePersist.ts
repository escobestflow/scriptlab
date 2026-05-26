// Server-side helpers that write generated image URLs (and the
// matching `imageGenAttempted` sentinel) directly into the project
// row in Supabase via the service-role client. This is what makes
// image generation *survive* a client navigation: even if the user
// closes the tab while OpenAI is still processing, the route's call
// here will finish the persist and the URL will be sitting in the
// row when they reload.
//
// Why this exists (and the bug it fixes): the client-side path used
// to be "setStory(thumbnail=URL); autosave debouncer (1s) → save".
// During those 1+ seconds the user could refresh the page; the URL
// uploaded to Storage but never made it into the project row. On
// reload the auto-fire effect saw `!ch.thumbnail && !ch.imageGen-
// Attempted` and fired ANOTHER generation. With this module's writes
// happening server-side, the row gets updated as soon as the upstream
// call returns — no debouncer race window.
//
// Concurrency note: this uses read-modify-write on the row's `data`
// JSONB. If the user is editing the same project at the exact moment
// we write, an autosave landing between our read and our write could
// be overwritten. The window is ~50ms in practice and the only fields
// we touch are `thumbnail` + `imageGenAttempted` (everything else is
// preserved from the row we just read). For a single-user beta app
// the risk is acceptable; if it ever matters we can move to a
// Postgres function with atomic jsonb_set.
//
// Every helper is fire-and-forget from the route's perspective —
// they never throw; failures console.warn and return false. The
// image is still returned to the client either way; the persistence
// is a "best effort" durability layer on top of the existing flow.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// ── Top-level project thumbnail (column, not JSONB) ─────────────
// /api/generate-thumbnail writes here. The `projects` table has a
// dedicated `thumbnail` column outside the `data` JSONB so this
// is a one-shot UPDATE — no read-modify-write needed.
export async function setProjectThumbnail(
  projectId: string,
  url: string,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { error } = await admin
      .from("projects")
      .update({ thumbnail: url, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (error) {
      console.warn(`[projectImagePersist] setProjectThumbnail(${projectId}): ${error.message}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[projectImagePersist] setProjectThumbnail threw: ${msg}`);
    return false;
  }
}

// ── Character thumbnail (nested in data.charactersDrafts[].characters[]) ──
// Updates EVERY draft containing the character (matched by id) so the
// thumbnail survives draft switches. Also sets imageGenAttempted=true
// across all matches, which is the sentinel the auto-fire effect
// checks to decide whether to (re-)generate.
export async function setCharacterThumbnail(
  projectId: string,
  characterId: string,
  url: string,
): Promise<boolean> {
  return mutateCharacter(projectId, characterId, (c) => {
    c.thumbnail = url;
    c.imageGenAttempted = true;
  });
}

// Called BEFORE the OpenAI call fires. Persists the
// `imageGenAttempted=true` sentinel immediately so a subsequent
// refresh during the 30–60s generation window doesn't trigger a
// duplicate fire. The thumbnail itself comes later via
// setCharacterThumbnail when the gen succeeds.
export async function markCharacterAttempted(
  projectId: string,
  characterId: string,
): Promise<boolean> {
  return mutateCharacter(projectId, characterId, (c) => {
    c.imageGenAttempted = true;
  });
}

// ── Beat / scene thumbnail (nested in data.storyDrafts[].beats[] OR
// data.storyDrafts[].episodes[].beats[] for TV) ────────────────
export async function setBeatThumbnail(
  projectId: string,
  beatId: string,
  url: string,
): Promise<boolean> {
  return mutateBeat(projectId, beatId, (b) => {
    b.thumbnail = url;
    b.imageGenAttempted = true;
  });
}

export async function markBeatAttempted(
  projectId: string,
  beatId: string,
): Promise<boolean> {
  return mutateBeat(projectId, beatId, (b) => {
    b.imageGenAttempted = true;
  });
}

// ── Episode thumbnail (TV-only; nested in data.episodesDrafts[].episodes[]) ─
// Mirrors the character/beat helpers. The credit-bleed guard (mark
// attempted BEFORE the OpenAI call) prevents a page refresh during the
// 30-60s generation window from triggering a duplicate spend on the
// next load — same protection the character + beat paths use.

export async function setEpisodeThumbnail(
  projectId: string,
  episodeId: string,
  url: string,
): Promise<boolean> {
  return mutateEpisode(projectId, episodeId, (e) => {
    e.thumbnail = url;
    e.imageGenAttempted = true;
  });
}

export async function markEpisodeAttempted(
  projectId: string,
  episodeId: string,
): Promise<boolean> {
  return mutateEpisode(projectId, episodeId, (e) => {
    e.imageGenAttempted = true;
  });
}

// ── Internals ────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

/**
 * Loads project.data, applies `mut` to every character whose id matches,
 * writes the row back. Returns true if at least one character was
 * mutated; false if the project / character wasn't found or the write
 * failed. Never throws — caller treats this as observability.
 */
async function mutateCharacter(
  projectId: string,
  characterId: string,
  mut: (char: AnyRecord) => void,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { data: row, error: readErr } = await admin
      .from("projects")
      .select("data")
      .eq("id", projectId)
      .single();
    if (readErr || !row?.data) {
      console.warn(`[projectImagePersist] mutateCharacter read(${projectId}): ${readErr?.message ?? "no row"}`);
      return false;
    }
    const data = row.data as AnyRecord;
    const drafts = (data.charactersDrafts as AnyRecord[] | undefined) ?? [];
    let touched = 0;
    for (const draft of drafts) {
      const chars = (draft.characters as AnyRecord[] | undefined) ?? [];
      for (const c of chars) {
        if (c.id === characterId) {
          mut(c);
          touched++;
        }
      }
    }
    if (touched === 0) {
      console.warn(`[projectImagePersist] mutateCharacter: character ${characterId} not found in project ${projectId}`);
      return false;
    }
    const { error: writeErr } = await admin
      .from("projects")
      .update({ data, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (writeErr) {
      console.warn(`[projectImagePersist] mutateCharacter write(${projectId}): ${writeErr.message}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[projectImagePersist] mutateCharacter threw: ${msg}`);
    return false;
  }
}

/**
 * Same shape as mutateCharacter, but walks the beats array. Beats live
 * either at `storyDrafts[].beats[]` (feature) or
 * `storyDrafts[].episodes[].beats[]` (TV). We try both locations so the
 * caller doesn't need to know the project type.
 */
async function mutateBeat(
  projectId: string,
  beatId: string,
  mut: (beat: AnyRecord) => void,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { data: row, error: readErr } = await admin
      .from("projects")
      .select("data")
      .eq("id", projectId)
      .single();
    if (readErr || !row?.data) {
      console.warn(`[projectImagePersist] mutateBeat read(${projectId}): ${readErr?.message ?? "no row"}`);
      return false;
    }
    const data = row.data as AnyRecord;
    const drafts = (data.storyDrafts as AnyRecord[] | undefined) ?? [];
    let touched = 0;
    for (const draft of drafts) {
      // Feature path
      const beats = (draft.beats as AnyRecord[] | undefined) ?? [];
      for (const b of beats) {
        if (b.id === beatId) { mut(b); touched++; }
      }
      // TV path
      const episodes = (draft.episodes as AnyRecord[] | undefined) ?? [];
      for (const ep of episodes) {
        const epBeats = (ep.beats as AnyRecord[] | undefined) ?? [];
        for (const b of epBeats) {
          if (b.id === beatId) { mut(b); touched++; }
        }
      }
    }
    if (touched === 0) {
      console.warn(`[projectImagePersist] mutateBeat: beat ${beatId} not found in project ${projectId}`);
      return false;
    }
    const { error: writeErr } = await admin
      .from("projects")
      .update({ data, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (writeErr) {
      console.warn(`[projectImagePersist] mutateBeat write(${projectId}): ${writeErr.message}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[projectImagePersist] mutateBeat threw: ${msg}`);
    return false;
  }
}

/**
 * Same shape as mutateCharacter / mutateBeat, but for the TV episode
 * layer. Episodes live at `episodesDrafts[].episodes[]`. No feature
 * fallback here — episodes are TV-only.
 */
async function mutateEpisode(
  projectId: string,
  episodeId: string,
  mut: (ep: AnyRecord) => void,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { data: row, error: readErr } = await admin
      .from("projects")
      .select("data")
      .eq("id", projectId)
      .single();
    if (readErr || !row?.data) {
      console.warn(`[projectImagePersist] mutateEpisode read(${projectId}): ${readErr?.message ?? "no row"}`);
      return false;
    }
    const data = row.data as AnyRecord;
    const drafts = (data.episodesDrafts as AnyRecord[] | undefined) ?? [];
    let touched = 0;
    for (const draft of drafts) {
      const episodes = (draft.episodes as AnyRecord[] | undefined) ?? [];
      for (const ep of episodes) {
        if (ep.id === episodeId) {
          mut(ep);
          touched++;
        }
      }
    }
    if (touched === 0) {
      console.warn(`[projectImagePersist] mutateEpisode: episode ${episodeId} not found in project ${projectId}`);
      return false;
    }
    const { error: writeErr } = await admin
      .from("projects")
      .update({ data, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (writeErr) {
      console.warn(`[projectImagePersist] mutateEpisode write(${projectId}): ${writeErr.message}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[projectImagePersist] mutateEpisode threw: ${msg}`);
    return false;
  }
}
