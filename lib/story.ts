// Structured story state — the single source of truth.

export type Genre =
  | "thriller" | "drama" | "comedy" | "horror"
  | "sci-fi" | "romance" | "action" | "mystery";

export type Framework =
  | "save-the-cat" | "heros-journey" | "three-act" | "story-circle";

export type EndingType =
  | "happy" | "bittersweet" | "tragic" | "ambiguous" | "twist";

export type ProjectType = "feature" | "short" | "tv-show";

export interface StorySettings {
  framework: Framework;
  genres: Genre[];           // multi-select
  vibe: string;
  unpredictability: number;  // 1-10
  darkness: number;          // 1-10
  pace: number;              // 1-10
  endingTypes: EndingType[]; // multi-select
}

export interface Character {
  id: string;
  name: string;
  role: string;
  want: string;
  need: string;
  notes: string;
}

export interface Ingredient {
  id: string;
  label: string;
  description: string;
  locked: boolean;
}

export interface Snippet {
  id: string;
  title: string;
  content: string;
  tags: string[];
  usedInBeats: string[];
}

export type BeatStatus = "design" | "written";

export interface Beat {
  id: string;
  name: string;
  summary: string;
  purpose: string;
  position: number;
  momentIds: string[];
  status: BeatStatus;
  sceneContent?: string;
}

export interface Episode {
  id: string;
  title: string;
  number: number;
  beats: Beat[];
}

export interface Story {
  id: string;
  title: string;
  logline: string;
  projectType: ProjectType;
  settings: StorySettings;
  characters: Character[];
  ingredients: Ingredient[];
  snippets: Snippet[];
  beats: Beat[];              // for feature/short
  episodes?: Episode[];       // for tv-show
  updatedAt: string;
}
