import { Story, Draft, Beat, Character, Concept, Script, SyncState, StorySettings } from "./story";
import { Moment } from "./sampleData";
import { supabase } from "./supabase";

// ── Field-level normalization ──

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

function normalizeSyncState(s: any): SyncState {
  return {
    conceptHash: s?.conceptHash,
    charactersHash: s?.charactersHash,
    storyHash: s?.storyHash,
    charactersOutOfSync: s?.charactersOutOfSync || false,
    storyOutOfSync: s?.storyOutOfSync || false,
    scriptOutOfSync: s?.scriptOutOfSync || false,
  };
}

function normalizeSettings(s: any): StorySettings {
  return {
    framework: s?.framework || "save-the-cat",
    genres: s?.genres ?? (s?.genre ? [s.genre] : []),
    vibe: s?.vibe || "",
    unpredictability: s?.unpredictability ?? 5,
    darkness: s?.darkness ?? 5,
    pace: s?.pace ?? 5,
    endingTypes: s?.endingTypes ?? (s?.endingType ? [s.endingType] : []),
  };
}

// ── Draft normalization ──
// Builds a draft from either a draft-shaped object or from legacy top-level fields.

function normalizeDraft(d: any, number: number = 1, fallbackTime?: string): Draft {
  const now = fallbackTime || new Date().toISOString();
  return {
    id: d?.id || "d_" + Math.random().toString(36).slice(2),
    number: d?.number ?? number,
    createdAt: d?.createdAt || now,
    updatedAt: d?.updatedAt || now,
    logline: d?.logline || "",
    settings: normalizeSettings(d?.settings),
    concept: normalizeConcept(d?.concept),
    characters: (d?.characters ?? []).map((c: any) => normalizeCharacter(c)),
    ingredients: d?.ingredients ?? [],
    snippets: d?.snippets ?? [],
    beats: (d?.beats ?? []).map((b: any, i: number) => normalizeBeat(b, i)),
    episodes: d?.episodes ?? undefined,
    script: normalizeScript(d?.script),
    syncState: normalizeSyncState(d?.syncState),
  };
}

// ── Story normalization ──
// Migrates legacy projects (content at top level) into the drafts[] model.

function normalizeStory(s: any): Story {
  const now = s.updatedAt || new Date().toISOString();

  // Legacy migration: if no drafts array, wrap top-level content as Draft 1.
  let drafts: Draft[];
  let activeDraftId: string;
  let draftCounter: number;

  if (Array.isArray(s.drafts) && s.drafts.length > 0) {
    drafts = s.drafts.map((d: any, i: number) => normalizeDraft(d, i + 1, now));
    activeDraftId = s.activeDraftId && drafts.some(d => d.id === s.activeDraftId)
      ? s.activeDraftId
      : drafts[0].id;
    draftCounter = s.draftCounter ?? Math.max(...drafts.map(d => d.number));
  } else {
    // Legacy: build Draft 1 from top-level content
    const initial = normalizeDraft(s, 1, now);
    drafts = [initial];
    activeDraftId = initial.id;
    draftCounter = 1;
  }

  return {
    id: s.id,
    title: s.title || "",
    projectType: s.projectType ?? "feature",
    thumbnail: s.thumbnail,
    drafts,
    activeDraftId,
    draftCounter,
    updatedAt: now,
  };
}

// ── Supabase CRUD for Projects ──

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

// ── Supabase CRUD for Moments ──

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
  const draftId = "d_" + Math.random().toString(36).slice(2);

  const initialDraft: Draft = {
    id: draftId,
    number: 1,
    createdAt: now,
    updatedAt: now,
    logline: "",
    settings: {
      framework: "save-the-cat",
      genres: [],
      vibe: "",
      unpredictability: 5,
      darkness: 5,
      pace: 5,
      endingTypes: [],
    },
    concept: { summary: "", tone: "", themes: [] },
    characters: [],
    ingredients: [],
    snippets: [],
    beats: [],
    script: { scenes: [], syncStatus: "synced" },
    syncState: {},
  };

  return {
    id: projectId,
    title: "",
    projectType: "feature",
    drafts: [initialDraft],
    activeDraftId: draftId,
    draftCounter: 1,
    updatedAt: now,
  };
}

// ── Create a new project from an existing draft ──
// Clones the draft's content into a brand new project.

export function createProjectFromDraft(sourceStory: Story, draftId: string): Story {
  const source = sourceStory.drafts.find(d => d.id === draftId) ?? sourceStory.drafts[0];
  const now = new Date().toISOString();
  const projectId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : "p_" + Math.random().toString(36).slice(2);
  const newDraftId = "d_" + Math.random().toString(36).slice(2);

  const clonedDraft: Draft = {
    ...source,
    id: newDraftId,
    number: 1,
    createdAt: now,
    updatedAt: now,
  };

  return {
    id: projectId,
    title: sourceStory.title ? `${sourceStory.title} (copy)` : "",
    projectType: sourceStory.projectType,
    thumbnail: sourceStory.thumbnail,
    drafts: [clonedDraft],
    activeDraftId: newDraftId,
    draftCounter: 1,
    updatedAt: now,
  };
}
