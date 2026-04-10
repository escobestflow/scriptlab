// Structured story state — the single source of truth.
// All UI edits mutate this JSON. All AI calls read/write this JSON.
// Keeping story as structured data (not chat logs) is what makes
// iterative editing cheap and "swap an ingredient" feel instant.

export type Genre =
  | "thriller" | "drama" | "comedy" | "horror"
  | "sci-fi" | "romance" | "action" | "mystery";

export type Framework =
  | "save-the-cat" | "heros-journey" | "three-act" | "story-circle";

export type EndingType =
  | "happy" | "bittersweet" | "tragic" | "ambiguous" | "twist";

export interface StorySettings {
  framework: Framework;
  genre: Genre;
  vibe: string;            // freeform: "melancholy noir", "80s summer"
  unpredictability: number; // 1-10
  darkness: number;         // 1-10
  pace: number;             // 1-10
  endingType: EndingType;
}

export interface Character {
  id: string;
  name: string;
  role: string;   // protagonist, antagonist, ally, etc.
  want: string;   // external goal
  need: string;   // internal arc
  notes: string;
}

export interface Ingredient {
  id: string;
  label: string;      // short tag user sees
  description: string; // the actual concept
  locked: boolean;    // if true, AI won't swap/modify this
}

export interface Snippet {
  id: string;
  title: string;
  content: string;   // the raw moment/scene/line
  tags: string[];    // for retrieval
  usedInBeats: string[];
}

export type BeatStatus = "design" | "written";

export interface Beat {
  id: string;
  name: string;         // "Opening Image", "Catalyst", etc.
  summary: string;      // what happens
  purpose: string;      // why it exists in the structure
  position: number;     // sequential order, updated on reorder
  momentIds: string[];  // linked Moment IDs from global pool
  status: BeatStatus;   // design = structured only, written = scene executed
  sceneContent?: string; // written prose, populated during Execution
}

export interface Story {
  id: string;
  title: string;
  logline: string;
  settings: StorySettings;
  characters: Character[];
  ingredients: Ingredient[];
  snippets: Snippet[];
  beats: Beat[];
  updatedAt: string;
}

export const SAMPLE_STORY: Story = {
  id: "demo-1",
  title: "Untitled Project",
  logline: "",
  settings: {
    framework: "save-the-cat",
    genre: "thriller",
    vibe: "neon-lit, rainy, lonely",
    unpredictability: 6,
    darkness: 7,
    pace: 5,
    endingType: "bittersweet",
  },
  characters: [
    { id: "c1", name: "Mae", role: "protagonist",
      want: "Find her missing sister", need: "Forgive herself", notes: "" },
  ],
  ingredients: [
    { id: "i1", label: "setting", description: "A 24-hour laundromat in a dead mall", locked: false },
    { id: "i2", label: "object", description: "A cassette tape with no label", locked: false },
    { id: "i3", label: "rule",   description: "The protagonist can't lie, even once", locked: true },
  ],
  snippets: [
    { id: "s1", title: "Fluorescent hum", tags: ["atmosphere","opening"],
      content: "The fluorescent lights hum in E-flat. She's counted them for an hour.",
      usedInBeats: [] },
  ],
  beats: [],
  updatedAt: new Date().toISOString(),
};
