import {
  Story, ProjectDraft, Beat, Character, Concept, Script, StorySettings,
  ConceptLayerDraft, CharactersLayerDraft, StoryLayerDraft, ScriptLayerDraft,
  emptyConceptDraft, emptyCharactersDraft, emptyStoryLayerDraft, emptyScriptDraft,
} from "./story";
import { Moment } from "./sampleData";
import { supabase } from "./supabase";

// ── Field normalization helpers ──

// Whitelist for the short-structure enum stored on StorySettings. Anything
// else loaded from a legacy save (including null/undefined) normalizes to
// null — i.e. "unset, prompts use generic Situation→Pressure→Shift".
const ALLOWED_SHORT_STRUCTURES = new Set([
  "complete", "open-ended", "proof-of-concept", "slice-of-life", "twist",
]);

function normalizeBeat(b: any, index: number): Beat {
  // Per-scene Twist / Weirdness dials. Both optional — undefined means
  // "unset", which the prompts read as "fall back to the project-level
  // defaults." Only accept finite numbers in [1,10] from disk.
  const twist = typeof b?.twist === "number" && b.twist >= 1 && b.twist <= 10
    ? b.twist : undefined;
  const weirdness = typeof b?.weirdness === "number" && b.weirdness >= 1 && b.weirdness <= 10
    ? b.weirdness : undefined;
  // Inline data-URL thumbnail (data:image/jpeg;base64,...). Anything
  // that isn't a non-empty string is dropped so saves can't grow a
  // junk thumbnail field.
  const thumbnail = typeof b?.thumbnail === "string" && b.thumbnail.trim().length > 0
    ? b.thumbnail : undefined;
  // Sticky auto-gen sentinel — once set, prevents future auto-image-
  // generation re-attempts for this beat across reloads.
  const imageGenAttempted = b?.imageGenAttempted === true ? true : undefined;
  return {
    position: index,
    momentIds: [],
    status: "design",
    ...b,
    twist,
    weirdness,
    thumbnail,
    imageGenAttempted,
  };
}

// Whitelist matching CHARACTER_VOICES + "onyx" in lib/scriptParse.ts
// (and CharacterAiVoice in lib/story.ts). Anything else loaded from a
// legacy save normalizes to null — i.e. "Auto, use the heuristic."
const ALLOWED_AI_VOICES = new Set([
  "alloy", "echo", "fable", "nova", "onyx", "shimmer",
]);

function normalizeCharacter(c: any): Character {
  return {
    id: c.id || "ch_" + Math.random().toString(36).slice(2),
    name: c.name || "",
    role: c.role || "",
    archetype: c.archetype || "",
    gender: typeof c.gender === "string" && c.gender ? c.gender : undefined,
    age: typeof c.age === "string" && c.age.trim() ? c.age : undefined,
    backstory: c.backstory || "",
    motivations: c.motivations || "",
    flaws: c.flaws || "",
    want: c.want || "",
    need: c.need || "",
    relationships: c.relationships || [],
    voice: c.voice || "",
    aiVoice: ALLOWED_AI_VOICES.has(c.aiVoice)
      ? (c.aiVoice as Character["aiVoice"]) : null,
    arc: c.arc || "",
    notes: c.notes || "",
    // Cross-episode lock: characters carry the id of the episode they
    // were created in. Legacy saves predate this — leave undefined and
    // let the Characters tab fall back to "owned by the active layer's
    // first episode" for the purpose of edit gating, so existing
    // projects remain editable rather than being silently locked.
    createdInEpisodeId: typeof c.createdInEpisodeId === "string" && c.createdInEpisodeId
      ? c.createdInEpisodeId
      : undefined,
    thumbnail: typeof c.thumbnail === "string" && c.thumbnail
      ? c.thumbnail
      : undefined,
    // Sticky auto-gen sentinel — preserved verbatim so the
    // "skip auto-gen on next reload" guarantee survives the DB
    // round-trip. Coerced to undefined when absent / falsy so older
    // saves don't carry an explicit `false` and force a re-attempt.
    imageGenAttempted: c.imageGenAttempted === true ? true : undefined,
  };
}

function normalizeConcept(c: any): Concept {
  return {
    summary: c?.summary || "",
    tone: c?.tone || "",
    themes: c?.themes || [],
  };
}

function normalizeScript(s: any): Script {
  return {
    scenes: s?.scenes || [],
    syncStatus: s?.syncStatus || "synced",
    lastSyncedAt: s?.lastSyncedAt,
    outOfSyncReason: s?.outOfSyncReason,
  };
}

function normalizeSettings(s: any): StorySettings {
  return {
    // Framework is optional. Legacy saves that explicitly stored a
    // framework keep it; missing/empty normalizes to null so the UI
    // can render "unset" and prompts can omit framework instructions.
    framework: (s?.framework || null) as StorySettings["framework"],
    genres: s?.genres ?? (s?.genre ? [s.genre] : []),
    // Older saves predate sub-genres — default to an empty list.
    subGenres: Array.isArray(s?.subGenres) ? s.subGenres : [],
    // References + writerStyles were added in a later migration. Normalize
    // defensively so older DB rows don't render with undefined fields.
    references: Array.isArray(s?.references)
      ? s.references.map((r: any, i: number) => ({
          id: String(r?.id || `ref_${Date.now()}_${i}`),
          title: String(r?.title || ""),
          aspects: Array.isArray(r?.aspects) ? r.aspects.map((a: any) => String(a)) : [],
        }))
      : [],
    writerStyles: Array.isArray(s?.writerStyles) ? s.writerStyles.map((w: any) => String(w)) : [],
    vibe: s?.vibe || "",
    unpredictability: s?.unpredictability ?? 5,
    darkness: s?.darkness ?? 5,
    pace: s?.pace ?? 5,
    endingTypes: s?.endingTypes ?? (s?.endingType ? [s.endingType] : []),
    // Short-film fields. Both default to absent for legacy saves and for
    // non-short projects; the UI hides them and the prompts use safe
    // defaults (12 min / generic 3-stage skeleton).
    duration: typeof s?.duration === "number" && s.duration > 0 && s.duration <= 60
      ? s.duration : undefined,
    shortStructure: ALLOWED_SHORT_STRUCTURES.has(s?.shortStructure)
      ? (s.shortStructure as StorySettings["shortStructure"]) : null,
    toneNote: typeof s?.toneNote === "string" ? s.toneNote : "",
    themesNote: typeof s?.themesNote === "string" ? s.themesNote : "",
    frameworkNote: typeof s?.frameworkNote === "string" ? s.frameworkNote : "",
    endingNote: typeof s?.endingNote === "string" ? s.endingNote : "",
  };
}

// ── Layer draft normalization ──

function normalizeConceptDraft(d: any, number = 1, ts?: string): ConceptLayerDraft {
  const now = ts || d?.updatedAt || new Date().toISOString();
  const updated = d?.updatedAt || now;
  return {
    id: d?.id || "cd_" + Math.random().toString(36).slice(2),
    number: d?.number ?? number,
    createdAt: d?.createdAt || now,
    updatedAt: updated,
    savedAt: d?.savedAt || updated,
    logline: d?.logline || "",
    settings: normalizeSettings(d?.settings),
    concept: normalizeConcept(d?.concept),
  };
}

function normalizeCharactersDraft(d: any, number = 1, ts?: string): CharactersLayerDraft {
  const now = ts || d?.updatedAt || new Date().toISOString();
  const updated = d?.updatedAt || now;
  return {
    id: d?.id || "chd_" + Math.random().toString(36).slice(2),
    number: d?.number ?? number,
    createdAt: d?.createdAt || now,
    updatedAt: updated,
    savedAt: d?.savedAt || updated,
    characters: (d?.characters ?? []).map((c: any) => normalizeCharacter(c)),
  };
}

function normalizeStoryLayerDraft(d: any, number = 1, ts?: string): StoryLayerDraft {
  const now = ts || d?.updatedAt || new Date().toISOString();
  const updated = d?.updatedAt || now;
  return {
    id: d?.id || "sd_" + Math.random().toString(36).slice(2),
    number: d?.number ?? number,
    createdAt: d?.createdAt || now,
    updatedAt: updated,
    savedAt: d?.savedAt || updated,
    beats: (d?.beats ?? []).map((b: any, i: number) => normalizeBeat(b, i)),
    episodes: d?.episodes ?? undefined,
    ingredients: d?.ingredients ?? [],
    snippets: d?.snippets ?? [],
    direction: typeof d?.direction === "string" ? d.direction : "",
  };
}

function normalizeScriptDraft(d: any, number = 1, ts?: string): ScriptLayerDraft {
  const now = ts || d?.updatedAt || new Date().toISOString();
  const updated = d?.updatedAt || now;
  return {
    id: d?.id || "scd_" + Math.random().toString(36).slice(2),
    number: d?.number ?? number,
    createdAt: d?.createdAt || now,
    updatedAt: updated,
    savedAt: d?.savedAt || updated,
    script: normalizeScript(d?.script),
  };
}

// ── Story normalization / migration ──
// Handles three shapes:
//  1. New: layered drafts (conceptDrafts[], etc. + projectDrafts[])
//  2. Mid: monolithic drafts[] with complete content (previous iteration)
//  3. Old: top-level content (pre-drafts)

function genId(prefix: string) {
  return prefix + "_" + Math.random().toString(36).slice(2);
}

export const normalizeStoryPublic = (s: any): Story => normalizeStory(s);

function normalizeStory(s: any): Story {
  const now = s.updatedAt || new Date().toISOString();

  // Shape 1: new layered structure
  if (Array.isArray(s.conceptDrafts) && Array.isArray(s.projectDrafts)) {
    const conceptDrafts    = s.conceptDrafts.map((d: any, i: number) => normalizeConceptDraft(d, i + 1));
    const charactersDrafts = (s.charactersDrafts ?? []).map((d: any, i: number) => normalizeCharactersDraft(d, i + 1));
    const storyDrafts      = (s.storyDrafts ?? []).map((d: any, i: number) => normalizeStoryLayerDraft(d, i + 1));
    const scriptDrafts     = (s.scriptDrafts ?? []).map((d: any, i: number) => normalizeScriptDraft(d, i + 1));
    const projectDrafts: ProjectDraft[] = (s.projectDrafts ?? []).map((pd: any, i: number) => {
      const upd = pd.updatedAt || now;
      const conceptId    = pd.conceptDraftId    || conceptDrafts[0]?.id;
      const charactersId = pd.charactersDraftId || charactersDrafts[0]?.id;
      const storyId      = pd.storyDraftId      || storyDrafts[0]?.id;
      const scriptId     = pd.scriptDraftId     || scriptDrafts[0]?.id;
      return {
        id: pd.id || genId("pd"),
        number: pd.number ?? i + 1,
        createdAt: pd.createdAt || now,
        updatedAt: upd,
        savedAt: pd.savedAt || upd,
        conceptDraftId: conceptId,
        charactersDraftId: charactersId,
        storyDraftId: storyId,
        scriptDraftId: scriptId,
        savedConceptDraftId:    pd.savedConceptDraftId    || conceptId,
        savedCharactersDraftId: pd.savedCharactersDraftId || charactersId,
        savedStoryDraftId:      pd.savedStoryDraftId      || storyId,
        savedScriptDraftId:     pd.savedScriptDraftId     || scriptId,
        conceptSyncedAt:    pd.conceptSyncedAt,
        charactersSyncedAt: pd.charactersSyncedAt,
        storySyncedAt:      pd.storySyncedAt,
      };
    });
    return {
      id: s.id,
      title: s.title || "",
      projectType: s.projectType ?? "feature",
      thumbnail: s.thumbnail,
      conceptDrafts,
      charactersDrafts,
      storyDrafts,
      scriptDrafts,
      projectDrafts,
      activeProjectDraftId: projectDrafts.some((pd: ProjectDraft) => pd.id === s.activeProjectDraftId)
        ? s.activeProjectDraftId
        : projectDrafts[0]?.id,
      counters: {
        concept: s.counters?.concept ?? conceptDrafts.length,
        characters: s.counters?.characters ?? charactersDrafts.length,
        story: s.counters?.story ?? storyDrafts.length,
        script: s.counters?.script ?? scriptDrafts.length,
        project: s.counters?.project ?? projectDrafts.length,
      },
      updatedAt: now,
    };
  }

  // Shape 2: monolithic drafts[] (previous iteration). Split each old draft into 4 layer drafts.
  if (Array.isArray(s.drafts) && s.drafts.length > 0) {
    const oldDrafts: any[] = s.drafts;
    const conceptDrafts: ConceptLayerDraft[] = [];
    const charactersDrafts: CharactersLayerDraft[] = [];
    const storyDrafts: StoryLayerDraft[] = [];
    const scriptDrafts: ScriptLayerDraft[] = [];
    const projectDrafts: ProjectDraft[] = [];

    oldDrafts.forEach((od, i) => {
      const ts = od.updatedAt || now;
      const cd: ConceptLayerDraft    = normalizeConceptDraft({ ...od, id: genId("cd") }, i + 1, ts);
      const chd: CharactersLayerDraft = normalizeCharactersDraft({ characters: od.characters, id: genId("chd") }, i + 1, ts);
      const sd: StoryLayerDraft      = normalizeStoryLayerDraft({
        beats: od.beats, episodes: od.episodes, ingredients: od.ingredients, snippets: od.snippets,
        id: genId("sd"),
      }, i + 1, ts);
      const scd: ScriptLayerDraft    = normalizeScriptDraft({ script: od.script, id: genId("scd") }, i + 1, ts);
      conceptDrafts.push(cd);
      charactersDrafts.push(chd);
      storyDrafts.push(sd);
      scriptDrafts.push(scd);
      projectDrafts.push({
        id: od.id || genId("pd"),
        number: od.number ?? i + 1,
        createdAt: od.createdAt || ts,
        updatedAt: od.updatedAt || ts,
        savedAt: od.updatedAt || ts,
        conceptDraftId: cd.id,
        charactersDraftId: chd.id,
        storyDraftId: sd.id,
        scriptDraftId: scd.id,
        savedConceptDraftId: cd.id,
        savedCharactersDraftId: chd.id,
        savedStoryDraftId: sd.id,
        savedScriptDraftId: scd.id,
        conceptSyncedAt: ts,
        charactersSyncedAt: ts,
        storySyncedAt: ts,
      });
    });

    return {
      id: s.id,
      title: s.title || "",
      projectType: s.projectType ?? "feature",
      thumbnail: s.thumbnail,
      conceptDrafts,
      charactersDrafts,
      storyDrafts,
      scriptDrafts,
      projectDrafts,
      activeProjectDraftId: projectDrafts.find(pd => pd.id === s.activeDraftId)?.id ?? projectDrafts[0].id,
      counters: {
        concept: conceptDrafts.length,
        characters: charactersDrafts.length,
        story: storyDrafts.length,
        script: scriptDrafts.length,
        project: projectDrafts.length,
      },
      updatedAt: now,
    };
  }

  // Shape 3: top-level legacy content — wrap into single layer drafts + one project draft.
  const cd = normalizeConceptDraft(s, 1, now);
  const chd = normalizeCharactersDraft(s, 1, now);
  const sd = normalizeStoryLayerDraft(s, 1, now);
  const scd = normalizeScriptDraft(s, 1, now);
  const pd: ProjectDraft = {
    id: genId("pd"),
    number: 1,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    conceptDraftId: cd.id,
    charactersDraftId: chd.id,
    storyDraftId: sd.id,
    scriptDraftId: scd.id,
    savedConceptDraftId: cd.id,
    savedCharactersDraftId: chd.id,
    savedStoryDraftId: sd.id,
    savedScriptDraftId: scd.id,
    conceptSyncedAt: now,
    charactersSyncedAt: now,
    storySyncedAt: now,
  };
  return {
    id: s.id,
    title: s.title || "",
    projectType: s.projectType ?? "feature",
    thumbnail: s.thumbnail,
    conceptDrafts: [cd],
    charactersDrafts: [chd],
    storyDrafts: [sd],
    scriptDrafts: [scd],
    projectDrafts: [pd],
    activeProjectDraftId: pd.id,
    counters: { concept: 1, characters: 1, story: 1, script: 1, project: 1 },
    updatedAt: now,
  };
}

// ── Supabase CRUD ──

export async function loadProjectsFromDB(userId: string): Promise<Story[]> {
  // `collaborator_user_id` is nullable. On single-user projects it's
  // NULL and we never attach the optional field to the Story. On
  // shared projects we expose it as Story.collaboratorUserId so the
  // UI can light up collab affordances (Phase 2). Nothing else about
  // the existing load path changes.
  const { data, error } = await supabase
    .from("projects")
    .select("id, data, thumbnail, collaborator_user_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];

  return data.map(row => {
    const story = normalizeStory({ ...row.data, id: row.id });
    if (row.thumbnail) story.thumbnail = row.thumbnail;
    if (row.collaborator_user_id) {
      story.collaboratorUserId = row.collaborator_user_id;
    }
    return story;
  });
}

/**
 * Load the partner's row for a shared project. Relies on the
 * "Users can view own and shared projects" RLS policy which permits
 * SELECT when auth.uid() matches EITHER user_id or collaborator_user_id.
 *
 * Returns a normalized Story annotated with `collaboratorUserId` (the
 * partner's own reverse pointer — which should be the current user's
 * id for any healthy pairing). Returns null when the partner row
 * isn't found, isn't paired with us, or on any error.
 */
export async function loadPartnerProjectData(
  projectId: string,
  partnerUserId: string,
): Promise<Story | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, data, thumbnail, collaborator_user_id")
    .eq("id", projectId)
    .eq("user_id", partnerUserId)
    .maybeSingle();

  if (error) {
    console.error("loadPartnerProjectData error:", error);
    return null;
  }
  if (!data) return null;

  const story = normalizeStory({ ...data.data, id: data.id });
  if (data.thumbnail) story.thumbnail = data.thumbnail;
  if (data.collaborator_user_id) {
    story.collaboratorUserId = data.collaborator_user_id;
  }
  return story;
}

export async function saveProjectToDB(userId: string, project: Story) {
  const { thumbnail, collaboratorUserId, ...rest } = project;
  const { error } = await supabase
    .from("projects")
    .upsert({
      id: project.id,
      user_id: userId,
      data: rest,
      thumbnail: thumbnail ?? null,
      // Preserves the collaborator pairing on every save. When unset
      // (single-user) we write NULL, which matches the column default.
      collaborator_user_id: collaboratorUserId ?? null,
      updated_at: new Date().toISOString(),
    });
  if (error) console.error("Save project error:", error);
}

/**
 * Delete THIS user's copy of the project. For shared projects the
 * partner's row is untouched — their copy survives independently
 * (the "soft divorce" model). For single-user projects this is the
 * only row and behaves exactly like before.
 *
 * `userId` is required for the collab case; the legacy-signature call
 * (no userId) is preserved as an escape hatch during the migration.
 */
export async function deleteProjectFromDB(projectId: string, userId?: string) {
  if (userId) {
    await supabase
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", userId);
    return;
  }
  await supabase.from("projects").delete().eq("id", projectId);
}

export async function loadMomentsFromDB(userId: string): Promise<Moment[]> {
  const { data, error } = await supabase
    .from("moments")
    .select("id, data")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map(row => ({ ...row.data, id: row.id } as Moment));
}

export async function saveMomentToDB(userId: string, moment: Moment) {
  const { error } = await supabase
    .from("moments")
    .upsert({
      id: moment.id,
      user_id: userId,
      data: moment,
      created_at: moment.createdAt,
    });
  if (error) console.error("Save moment error:", error);
}

export async function deleteMomentFromDB(momentId: string) {
  await supabase.from("moments").delete().eq("id", momentId);
}

// ── New blank project ──

export function newBlankProject(): Story {
  const now = new Date().toISOString();
  const projectId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : "p_" + Math.random().toString(36).slice(2);

  const cd  = emptyConceptDraft(genId("cd"), 1, now);
  const chd = emptyCharactersDraft(genId("chd"), 1, now);
  const sd  = emptyStoryLayerDraft(genId("sd"), 1, now);
  const scd = emptyScriptDraft(genId("scd"), 1, now);
  const pd: ProjectDraft = {
    id: genId("pd"), number: 1, createdAt: now, updatedAt: now, savedAt: now,
    conceptDraftId: cd.id, charactersDraftId: chd.id,
    storyDraftId: sd.id, scriptDraftId: scd.id,
    savedConceptDraftId: cd.id, savedCharactersDraftId: chd.id,
    savedStoryDraftId: sd.id, savedScriptDraftId: scd.id,
    conceptSyncedAt: now, charactersSyncedAt: now, storySyncedAt: now,
  };

  return {
    id: projectId,
    title: "",
    projectType: "feature",
    conceptDrafts: [cd],
    charactersDrafts: [chd],
    storyDrafts: [sd],
    scriptDrafts: [scd],
    projectDrafts: [pd],
    activeProjectDraftId: pd.id,
    counters: { concept: 1, characters: 1, story: 1, script: 1, project: 1 },
    updatedAt: now,
  };
}

// ── Create a new project from an existing project draft ──

export function createProjectFromDraft(sourceStory: Story, projectDraftId: string): Story {
  const sourcePD = sourceStory.projectDrafts.find(pd => pd.id === projectDraftId) ?? sourceStory.projectDrafts[0];
  const srcConcept    = sourceStory.conceptDrafts.find(d => d.id === sourcePD.conceptDraftId)!;
  const srcCharacters = sourceStory.charactersDrafts.find(d => d.id === sourcePD.charactersDraftId)!;
  const srcStory      = sourceStory.storyDrafts.find(d => d.id === sourcePD.storyDraftId)!;
  const srcScript     = sourceStory.scriptDrafts.find(d => d.id === sourcePD.scriptDraftId)!;
  const now = new Date().toISOString();
  const projectId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : "p_" + Math.random().toString(36).slice(2);

  const cd: ConceptLayerDraft    = { ...srcConcept,    id: genId("cd"),  number: 1, createdAt: now, updatedAt: now };
  const chd: CharactersLayerDraft = { ...srcCharacters, id: genId("chd"), number: 1, createdAt: now, updatedAt: now };
  const sd: StoryLayerDraft      = { ...srcStory,      id: genId("sd"),  number: 1, createdAt: now, updatedAt: now };
  const scd: ScriptLayerDraft    = { ...srcScript,     id: genId("scd"), number: 1, createdAt: now, updatedAt: now };
  const pd: ProjectDraft = {
    id: genId("pd"), number: 1, createdAt: now, updatedAt: now, savedAt: now,
    conceptDraftId: cd.id, charactersDraftId: chd.id,
    storyDraftId: sd.id, scriptDraftId: scd.id,
    savedConceptDraftId: cd.id, savedCharactersDraftId: chd.id,
    savedStoryDraftId: sd.id, savedScriptDraftId: scd.id,
    conceptSyncedAt: now, charactersSyncedAt: now, storySyncedAt: now,
  };

  return {
    id: projectId,
    title: sourceStory.title ? `${sourceStory.title} (copy)` : "",
    projectType: sourceStory.projectType,
    thumbnail: sourceStory.thumbnail,
    conceptDrafts: [cd],
    charactersDrafts: [chd],
    storyDrafts: [sd],
    scriptDrafts: [scd],
    projectDrafts: [pd],
    activeProjectDraftId: pd.id,
    counters: { concept: 1, characters: 1, story: 1, script: 1, project: 1 },
    updatedAt: now,
  };
}
