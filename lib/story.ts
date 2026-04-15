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

// ── Concept layer ──

export interface Concept {
  summary: string;          // 2-3 sentence premise
  tone: string;             // "dark comedy", "tense", etc.
  themes: string[];         // e.g. ["redemption", "identity", "loss"]
}

// ── Character layer (expanded) ──

export interface CharacterRelationship {
  characterId: string;
  description: string;      // e.g. "rival", "estranged daughter"
}

export interface Character {
  id: string;
  name: string;
  role: string;             // protagonist, antagonist, supporting, etc.
  archetype: string;        // e.g. "the mentor", "the trickster"
  backstory: string;
  motivations: string;
  flaws: string;
  want: string;
  need: string;
  relationships: CharacterRelationship[];
  voice: string;            // speaking style description
  arc: string;              // character arc summary
  notes: string;
}

// ── Ingredients & Snippets ──

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

// ── Story / Beat layer ──

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

// ── Script layer ──

export interface Scene {
  id: string;
  beatId: string;           // linked to a beat
  heading: string;          // INT. COFFEE SHOP - DAY
  content: string;          // formatted screenplay text
  notes: string;            // writer notes
  lastGeneratedFrom?: string; // hash/timestamp of upstream state when generated
}

export interface Script {
  scenes: Scene[];
  syncStatus: "synced" | "out-of-sync";
  lastSyncedAt?: string;    // ISO timestamp
  outOfSyncReason?: string; // what changed upstream
}

// ── Sync tracking ──

export interface SyncState {
  conceptHash?: string;     // snapshot of concept when downstream was last synced
  charactersHash?: string;
  storyHash?: string;
  charactersOutOfSync?: boolean;
  storyOutOfSync?: boolean;
  scriptOutOfSync?: boolean;
}

// ── Main Story type ──

export interface Story {
  id: string;
  title: string;
  logline: string;
  projectType: ProjectType;
  settings: StorySettings;
  concept: Concept;
  characters: Character[];
  ingredients: Ingredient[];
  snippets: Snippet[];
  beats: Beat[];              // for feature/short
  episodes?: Episode[];       // for tv-show
  script: Script;
  syncState: SyncState;
  thumbnail?: string;         // base64 data URL for AI-generated cover
  updatedAt: string;
}
