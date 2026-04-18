import {
  Story, ProjectDraft, Beat, Character, Concept, Script, StorySettings,
  ConceptLayerDraft, CharactersLayerDraft, StoryLayerDraft, ScriptLayerDraft,
  emptyConceptDraft, emptyCharactersDraft, emptyStoryLayerDraft, emptyScriptDraft,
} from "./story";
import { Moment } from "./sampleData";
import { supabase } from "./supabase";

// ── Field normalization helpers ──

function normalizeBeat(b: any, index: number): Beat {
  return {
    position: index,
    momentIds: [],
    status: "design",
    ...b,
  };
}

function normalizeCharacter(c: any): Character {
  return {
    id: c.id || "ch_" + Math.random().toString(36).slice(2),
    name: c.name || "",
    role: c.role || "",
    archetype: c.archetype || "",
    backstory: c.backstory || "",
    motivations: c.motivations || "",
    flaws: c.flaws || "",
    want: c.want || "",
    need: c.need || "",
    relationships: c.relationships || [],
    voice: c.voice || "",
    arc: c.arc || "",
    notes: c.notes || "",
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
    framework: s?.framework || "save-the-cat",
    genres: s?.genres ?? (s?.genre ? [s.genre] : []),
    // Older saves predate sub-genres — default to an empty list.
    subGenres: Array.isArray(s?.subGenres) ? s.subGenres : [],
    vibe: s?.vibe || "",
    unpredictability: s?.unpredictability ?? 5,
    darkness: s?.darkness ?? 5,
    pace: s?.pace ?? 5,
    endingTypes: s?.endingTypes ?? (s?.endingType ? [s.endingType] : []),
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
  const { data, error } = await supabase
    .from("projects")
    .select("id, data, thumbnail")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];

  return data.map(row => {
    const story = normalizeStory({ ...row.data, id: row.id });
    if (row.thumbnail) story.thumbnail = row.thumbnail;
    return story;
  });
}

export async function saveProjectToDB(userId: string, project: Story) {
  const { thumbnail, ...rest } = project;
  const { error } = await supabase
    .from("projects")
    .upsert({
      id: project.id,
      user_id: userId,
      data: rest,
      thumbnail: thumbnail ?? null,
      updated_at: new Date().toISOString(),
    });
  if (error) console.error("Save project error:", error);
}

export async function deleteProjectFromDB(projectId: string) {
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
