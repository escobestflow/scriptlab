import { Story, Beat } from "./story";
import { Moment } from "./sampleData";
import { supabase } from "./supabase";

// ── Beat normalization (backward compat) ──

function normalizeBeat(b: any, index: number): Beat {
  return {
    position: index,
    momentIds: [],
    status: "design",
    ...b,
  };
}

function normalizeStory(s: any): Story {
  return {
    ...s,
    projectType: s.projectType ?? "feature",
    settings: {
      ...s.settings,
      genres: s.settings?.genres ?? (s.settings?.genre ? [s.settings.genre] : ["thriller"]),
      endingTypes: s.settings?.endingTypes ?? (s.settings?.endingType ? [s.settings.endingType] : ["bittersweet"]),
    },
    beats: (s.beats ?? []).map((b: any, i: number) => normalizeBeat(b, i)),
    episodes: s.episodes ?? undefined,
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
  return {
    id:
      (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : "p_" + Math.random().toString(36).slice(2),
    title: "",
    logline: "",
    projectType: "feature",
    settings: {
      framework: "save-the-cat",
      genres: [],
      vibe: "",
      unpredictability: 5,
      darkness: 5,
      pace: 5,
      endingTypes: [],
    },
    characters: [],
    ingredients: [],
    snippets: [],
    beats: [],
    updatedAt: new Date().toISOString(),
  };
}
