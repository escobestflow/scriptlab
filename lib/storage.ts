import { Story, Beat } from "./story";
import { Moment, SAMPLE_PROJECTS, SAMPLE_MOMENTS } from "./sampleData";

const P_KEY = "scriptwriter.projects.v4";
const M_KEY = "scriptwriter.moments.v1";

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

export function loadProjects(): Story[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(P_KEY);
    if (!raw) {
      saveProjects(SAMPLE_PROJECTS);
      return SAMPLE_PROJECTS;
    }
    return JSON.parse(raw).map(normalizeStory);
  } catch { return []; }
}

export function saveProjects(projects: Story[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(P_KEY, JSON.stringify(projects));
  } catch (e) {
    // localStorage quota exceeded — strip thumbnails and retry
    console.warn("Storage quota exceeded, stripping thumbnails");
    const stripped = projects.map(p => ({ ...p, thumbnail: undefined }));
    try { localStorage.setItem(P_KEY, JSON.stringify(stripped)); } catch {}
  }
}

export function loadMoments(): Moment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(M_KEY);
    if (!raw) {
      saveMoments(SAMPLE_MOMENTS);
      return SAMPLE_MOMENTS;
    }
    return JSON.parse(raw);
  } catch { return []; }
}

export function saveMoments(moments: Moment[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(M_KEY, JSON.stringify(moments));
}

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
