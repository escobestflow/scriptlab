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
  lastGeneratedFrom?: string;
}

export interface Script {
  scenes: Scene[];
  syncStatus: "synced" | "out-of-sync";
  lastSyncedAt?: string;
  outOfSyncReason?: string;
}

// ── Sync tracking ──

export interface SyncState {
  conceptHash?: string;
  charactersHash?: string;
  storyHash?: string;
  charactersOutOfSync?: boolean;
  storyOutOfSync?: boolean;
  scriptOutOfSync?: boolean;
}

// ── Draft ──
// A Draft is a complete snapshot of the editable project content.
// Every project has at least one draft. Users can create new drafts as
// checkpoints/versions, load older drafts, or spin a draft into a new project.

export interface Draft {
  id: string;
  number: number;           // user-facing sequential number ("Draft 1", "Draft 2")
  createdAt: string;
  updatedAt: string;
  // All editable content:
  logline: string;
  settings: StorySettings;
  concept: Concept;
  characters: Character[];
  ingredients: Ingredient[];
  snippets: Snippet[];
  beats: Beat[];            // for feature/short
  episodes?: Episode[];     // for tv-show
  script: Script;
  syncState: SyncState;
}

// ── Main Story type ──
// A Story holds shared metadata (title, projectType, thumbnail) and a set
// of drafts. All editable content lives inside drafts. The active draft
// is what the user is currently editing.

export interface Story {
  id: string;
  title: string;                 // shared across drafts
  projectType: ProjectType;      // shared across drafts
  thumbnail?: string;            // shared across drafts
  drafts: Draft[];
  activeDraftId: string;
  draftCounter: number;          // for generating draft numbers
  updatedAt: string;
}

// ── Draft helpers ──

export function getActiveDraft(story: Story): Draft {
  return story.drafts.find(d => d.id === story.activeDraftId) ?? story.drafts[0];
}

export function updateActiveDraft(story: Story, patch: Partial<Draft>): Story {
  const now = new Date().toISOString();
  return {
    ...story,
    drafts: story.drafts.map(d =>
      d.id === story.activeDraftId
        ? { ...d, ...patch, updatedAt: now }
        : d
    ),
    updatedAt: now,
  };
}

export function createNewDraft(story: Story): Story {
  const active = getActiveDraft(story);
  const now = new Date().toISOString();
  const nextNumber = story.draftCounter + 1;
  const newDraft: Draft = {
    ...active,
    id: "d_" + Math.random().toString(36).slice(2),
    number: nextNumber,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...story,
    drafts: [...story.drafts, newDraft],
    activeDraftId: newDraft.id,
    draftCounter: nextNumber,
    updatedAt: now,
  };
}

export function activateDraft(story: Story, draftId: string): Story {
  if (!story.drafts.some(d => d.id === draftId)) return story;
  return {
    ...story,
    activeDraftId: draftId,
    updatedAt: new Date().toISOString(),
  };
}

export function deleteDraft(story: Story, draftId: string): Story {
  if (story.drafts.length <= 1) return story; // can't delete the only draft
  const filtered = story.drafts.filter(d => d.id !== draftId);
  const nextActive = story.activeDraftId === draftId
    ? filtered[0].id
    : story.activeDraftId;
  return {
    ...story,
    drafts: filtered,
    activeDraftId: nextActive,
    updatedAt: new Date().toISOString(),
  };
}
