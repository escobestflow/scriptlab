import { Story } from "./story";
import { Moment, SAMPLE_PROJECTS, SAMPLE_MOMENTS } from "./sampleData";

const P_KEY = "scriptwriter.projects.v2";
const M_KEY = "scriptwriter.moments.v1";

export function loadProjects(): Story[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(P_KEY);
    if (!raw) {
      // Seed with sample data on first launch
      saveProjects(SAMPLE_PROJECTS);
      return SAMPLE_PROJECTS;
    }
    return JSON.parse(raw);
  } catch { return []; }
}

export function saveProjects(projects: Story[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(P_KEY, JSON.stringify(projects));
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
    settings: {
      framework: "save-the-cat",
      genre: "thriller",
      vibe: "",
      unpredictability: 5,
      darkness: 5,
      pace: 5,
      endingType: "bittersweet",
    },
    characters: [],
    ingredients: [],
    snippets: [],
    beats: [],
    updatedAt: new Date().toISOString(),
  };
}
