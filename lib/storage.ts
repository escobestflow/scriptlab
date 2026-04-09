// Local project persistence. Swap for Supabase later.
import { Story } from "./story";

const KEY = "scriptwriter.projects.v1";

export function loadProjects(): Story[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}

export function saveProjects(projects: Story[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(projects));
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
