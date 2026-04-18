// Structured story state — the single source of truth.
// Now with layer-level drafts: each layer (Concept, Characters, Story, Script)
// maintains its own pool of drafts. A "ProjectDraft" is a named combination
// of layer draft IDs. This enables mix-and-match experimentation.

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
  genres: Genre[];
  vibe: string;
  unpredictability: number;  // 1-10
  darkness: number;          // 1-10
  pace: number;              // 1-10
  endingTypes: EndingType[];
}

export interface Concept {
  summary: string;
  tone: string;
  themes: string[];
}

export interface CharacterRelationship {
  characterId: string;
  description: string;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  archetype: string;
  backstory: string;
  motivations: string;
  flaws: string;
  want: string;
  need: string;
  relationships: CharacterRelationship[];
  voice: string;
  arc: string;
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

export interface Scene {
  id: string;
  /**
   * ID of the Story-layer beat that produced this scene, or `null` for
   * synthetic scenes created when an upstream beat doesn't exist yet
   * (e.g. Concept→Script sync, before the user ever filled the Story tab).
   */
  beatId: string | null;
  heading: string;
  content: string;
  notes: string;
  lastGeneratedFrom?: string;
}

export interface Script {
  scenes: Scene[];
  syncStatus: "synced" | "out-of-sync";
  lastSyncedAt?: string;
  outOfSyncReason?: string;
}

// ── Layer drafts ──
// Each layer has its own drafts pool. A draft carries all content for that layer.

// Snapshot of concept-tab fields at the moment of last save.
// Also captures Story.title + Story.projectType which are shared
// across drafts but editable from the Concept tab.
export interface ConceptSavedSnapshot {
  title: string;
  projectType: ProjectType;
  logline: string;
  settings: StorySettings;
  concept: Concept;
}

export interface ConceptLayerDraft {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string;          // moves only when user explicitly saves
  logline: string;
  settings: StorySettings;
  concept: Concept;
  savedSnapshot?: ConceptSavedSnapshot; // for per-field change dots
}

export interface CharactersLayerDraft {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  characters: Character[];
}

export interface StoryLayerDraft {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  beats: Beat[];
  episodes?: Episode[];
  ingredients: Ingredient[];
  snippets: Snippet[];
}

export interface ScriptLayerDraft {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  script: Script;
}

// ── Project draft ──
// A named combination of layer draft IDs. Editing a layer affects every
// project draft that references it (reference semantics).

export interface ProjectDraft {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;    // bumps when the layer combination changes
  savedAt: string;      // moves only when the user explicitly saves
  conceptDraftId: string;
  charactersDraftId: string;
  storyDraftId: string;
  scriptDraftId: string;
  // Saved layer IDs at time of last save — used to detect per-tab
  // "has this layer changed since save" indicators.
  savedConceptDraftId?: string;
  savedCharactersDraftId?: string;
  savedStoryDraftId?: string;
  savedScriptDraftId?: string;
  // Sync markers: ISO timestamps of when each upstream layer was "synced"
  // into this project draft. If upstream.updatedAt > this marker, the
  // downstream is considered out-of-sync.
  conceptSyncedAt?: string;
  charactersSyncedAt?: string;
  storySyncedAt?: string;
}

// ── Story (project) ──

export interface Story {
  id: string;
  title: string;
  projectType: ProjectType;
  thumbnail?: string;
  thumbnailPromptExtra?: string;
  conceptDrafts: ConceptLayerDraft[];
  charactersDrafts: CharactersLayerDraft[];
  storyDrafts: StoryLayerDraft[];
  scriptDrafts: ScriptLayerDraft[];
  projectDrafts: ProjectDraft[];
  activeProjectDraftId: string;
  counters: {
    concept: number;
    characters: number;
    story: number;
    script: number;
    project: number;
  };
  updatedAt: string;
}

export type LayerKey = "concept" | "characters" | "story" | "script";

// ── Default factories ──

export function emptyConceptDraft(id: string, number: number, ts: string): ConceptLayerDraft {
  return {
    id, number, createdAt: ts, updatedAt: ts, savedAt: ts,
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
  };
}

export function emptyCharactersDraft(id: string, number: number, ts: string): CharactersLayerDraft {
  return { id, number, createdAt: ts, updatedAt: ts, savedAt: ts, characters: [] };
}

export function emptyStoryLayerDraft(id: string, number: number, ts: string): StoryLayerDraft {
  return {
    id, number, createdAt: ts, updatedAt: ts, savedAt: ts,
    beats: [],
    ingredients: [],
    snippets: [],
  };
}

export function emptyScriptDraft(id: string, number: number, ts: string): ScriptLayerDraft {
  return {
    id, number, createdAt: ts, updatedAt: ts, savedAt: ts,
    script: { scenes: [], syncStatus: "synced" },
  };
}

// ── Helpers: getters ──

export function getActiveProjectDraft(story: Story): ProjectDraft {
  return story.projectDrafts.find(p => p.id === story.activeProjectDraftId) ?? story.projectDrafts[0];
}

export function getActiveConceptDraft(story: Story): ConceptLayerDraft {
  const pd = getActiveProjectDraft(story);
  return story.conceptDrafts.find(d => d.id === pd.conceptDraftId) ?? story.conceptDrafts[0];
}

export function getActiveCharactersDraft(story: Story): CharactersLayerDraft {
  const pd = getActiveProjectDraft(story);
  return story.charactersDrafts.find(d => d.id === pd.charactersDraftId) ?? story.charactersDrafts[0];
}

export function getActiveStoryLayerDraft(story: Story): StoryLayerDraft {
  const pd = getActiveProjectDraft(story);
  return story.storyDrafts.find(d => d.id === pd.storyDraftId) ?? story.storyDrafts[0];
}

export function getActiveScriptDraft(story: Story): ScriptLayerDraft {
  const pd = getActiveProjectDraft(story);
  return story.scriptDrafts.find(d => d.id === pd.scriptDraftId) ?? story.scriptDrafts[0];
}

// ── Helpers: layer updates ──
// Each updates the currently-active layer draft's content and bumps timestamps.

function genId(prefix: string) {
  return prefix + "_" + Math.random().toString(36).slice(2);
}

export function updateConceptDraft(story: Story, patch: Partial<ConceptLayerDraft>): Story {
  const now = new Date().toISOString();
  const pd = getActiveProjectDraft(story);
  return {
    ...story,
    conceptDrafts: story.conceptDrafts.map(d =>
      d.id === pd.conceptDraftId ? { ...d, ...patch, updatedAt: now } : d
    ),
    updatedAt: now,
  };
}

export function updateCharactersDraft(story: Story, patch: Partial<CharactersLayerDraft>): Story {
  const now = new Date().toISOString();
  const pd = getActiveProjectDraft(story);
  return {
    ...story,
    charactersDrafts: story.charactersDrafts.map(d =>
      d.id === pd.charactersDraftId ? { ...d, ...patch, updatedAt: now } : d
    ),
    updatedAt: now,
  };
}

export function updateStoryLayerDraft(story: Story, patch: Partial<StoryLayerDraft>): Story {
  const now = new Date().toISOString();
  const pd = getActiveProjectDraft(story);
  return {
    ...story,
    storyDrafts: story.storyDrafts.map(d =>
      d.id === pd.storyDraftId ? { ...d, ...patch, updatedAt: now } : d
    ),
    updatedAt: now,
  };
}

export function updateScriptDraft(story: Story, patch: Partial<ScriptLayerDraft>): Story {
  const now = new Date().toISOString();
  const pd = getActiveProjectDraft(story);
  return {
    ...story,
    scriptDrafts: story.scriptDrafts.map(d =>
      d.id === pd.scriptDraftId ? { ...d, ...patch, updatedAt: now } : d
    ),
    updatedAt: now,
  };
}

// ── Helpers: create new layer draft ──
// Snapshot current active layer content as a new draft, point active project draft at it.

export function createNewConceptDraft(story: Story): Story {
  const now = new Date().toISOString();
  const active = getActiveConceptDraft(story);
  const nextNumber = story.counters.concept + 1;
  const newDraft: ConceptLayerDraft = {
    ...active,
    id: genId("cd"),
    number: nextNumber,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    savedSnapshot: {
      title: story.title,
      projectType: story.projectType,
      logline: active.logline,
      settings: active.settings,
      concept: active.concept,
    },
  };
  return {
    ...story,
    conceptDrafts: [...story.conceptDrafts, newDraft],
    counters: { ...story.counters, concept: nextNumber },
    projectDrafts: story.projectDrafts.map(pd =>
      pd.id === story.activeProjectDraftId
        ? { ...pd, conceptDraftId: newDraft.id, conceptSyncedAt: now, updatedAt: now }
        : pd
    ),
    updatedAt: now,
  };
}

export function createNewCharactersDraft(story: Story): Story {
  const now = new Date().toISOString();
  const active = getActiveCharactersDraft(story);
  const nextNumber = story.counters.characters + 1;
  const newDraft: CharactersLayerDraft = {
    ...active,
    id: genId("chd"),
    number: nextNumber,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
  };
  return {
    ...story,
    charactersDrafts: [...story.charactersDrafts, newDraft],
    counters: { ...story.counters, characters: nextNumber },
    projectDrafts: story.projectDrafts.map(pd =>
      pd.id === story.activeProjectDraftId
        ? { ...pd, charactersDraftId: newDraft.id, charactersSyncedAt: now, updatedAt: now }
        : pd
    ),
    updatedAt: now,
  };
}

export function createNewStoryLayerDraft(story: Story): Story {
  const now = new Date().toISOString();
  const active = getActiveStoryLayerDraft(story);
  const nextNumber = story.counters.story + 1;
  const newDraft: StoryLayerDraft = {
    ...active,
    id: genId("sd"),
    number: nextNumber,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
  };
  return {
    ...story,
    storyDrafts: [...story.storyDrafts, newDraft],
    counters: { ...story.counters, story: nextNumber },
    projectDrafts: story.projectDrafts.map(pd =>
      pd.id === story.activeProjectDraftId
        ? { ...pd, storyDraftId: newDraft.id, storySyncedAt: now, updatedAt: now }
        : pd
    ),
    updatedAt: now,
  };
}

export function createNewScriptDraft(story: Story): Story {
  const now = new Date().toISOString();
  const active = getActiveScriptDraft(story);
  const nextNumber = story.counters.script + 1;
  const newDraft: ScriptLayerDraft = {
    ...active,
    id: genId("scd"),
    number: nextNumber,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
  };
  return {
    ...story,
    scriptDrafts: [...story.scriptDrafts, newDraft],
    counters: { ...story.counters, script: nextNumber },
    projectDrafts: story.projectDrafts.map(pd =>
      pd.id === story.activeProjectDraftId
        ? { ...pd, scriptDraftId: newDraft.id, updatedAt: now }
        : pd
    ),
    updatedAt: now,
  };
}

export function createNewLayerDraft(story: Story, layer: LayerKey): Story {
  switch (layer) {
    case "concept":    return createNewConceptDraft(story);
    case "characters": return createNewCharactersDraft(story);
    case "story":      return createNewStoryLayerDraft(story);
    case "script":     return createNewScriptDraft(story);
  }
}

// ── Save layer draft ──
// Mark the active layer draft as "saved" — advances savedAt to updatedAt.
// No new draft is created; this just clears the dirty state.

export function saveLayerDraft(story: Story, layer: LayerKey): Story {
  const pd = getActiveProjectDraft(story);
  const now = new Date().toISOString();
  const refKey: "conceptDraftId" | "charactersDraftId" | "storyDraftId" | "scriptDraftId" =
    layer === "concept"    ? "conceptDraftId" :
    layer === "characters" ? "charactersDraftId" :
    layer === "story"      ? "storyDraftId" :
                             "scriptDraftId";
  const activeId = pd[refKey];

  const mapDraft = <T extends { id: string; updatedAt: string; savedAt: string }>(arr: T[]): T[] =>
    arr.map(d => d.id === activeId ? { ...d, savedAt: d.updatedAt } : d);

  switch (layer) {
    case "concept": {
      // Snapshot current concept fields + shared Story fields (title/projectType)
      const snapshot: ConceptSavedSnapshot = {
        title: story.title,
        projectType: story.projectType,
        logline: getActiveConceptDraft(story).logline,
        settings: getActiveConceptDraft(story).settings,
        concept: getActiveConceptDraft(story).concept,
      };
      return {
        ...story,
        conceptDrafts: story.conceptDrafts.map(d =>
          d.id === activeId
            ? { ...d, savedAt: d.updatedAt, savedSnapshot: snapshot }
            : d
        ),
        updatedAt: now,
      };
    }
    case "characters":
      return { ...story, charactersDrafts: mapDraft(story.charactersDrafts), updatedAt: now };
    case "story":
      return { ...story, storyDrafts: mapDraft(story.storyDrafts), updatedAt: now };
    case "script":
      return { ...story, scriptDrafts: mapDraft(story.scriptDrafts), updatedAt: now };
  }
}

// Save the project draft's current layer combination — advances pd.savedAt
// and snapshots the current layer IDs into savedXDraftId fields.
export function saveProjectDraft(story: Story): Story {
  const now = new Date().toISOString();
  return {
    ...story,
    projectDrafts: story.projectDrafts.map(pd =>
      pd.id === story.activeProjectDraftId
        ? {
            ...pd,
            savedAt: pd.updatedAt,
            savedConceptDraftId: pd.conceptDraftId,
            savedCharactersDraftId: pd.charactersDraftId,
            savedStoryDraftId: pd.storyDraftId,
            savedScriptDraftId: pd.scriptDraftId,
          }
        : pd
    ),
    updatedAt: now,
  };
}

// Check if a layer draft is dirty (has unsaved edits).
export function isLayerDraftDirty(
  draft: { updatedAt: string; savedAt: string } | undefined
): boolean {
  if (!draft) return false;
  return new Date(draft.updatedAt).getTime() > new Date(draft.savedAt).getTime();
}

// Check if the active project draft's combination has been changed since saved.
export function isProjectDraftDirty(story: Story): boolean {
  const pd = getActiveProjectDraft(story);
  if (!pd) return false;
  return new Date(pd.updatedAt).getTime() > new Date(pd.savedAt).getTime();
}

// ── Per-tab change detection (for tab bar dots) ──
// A tab shows a dot only when the active layer draft has unsaved option
// edits. Creating or switching drafts alone does NOT trigger the dot.
export function isLayerChangedForTabDot(story: Story, layer: LayerKey): boolean {
  const draft =
    layer === "concept"    ? getActiveConceptDraft(story) :
    layer === "characters" ? getActiveCharactersDraft(story) :
    layer === "story"      ? getActiveStoryLayerDraft(story) :
                             getActiveScriptDraft(story);
  return isLayerDraftDirty(draft);
}

// ── Per-field change detection for Concept tab ──

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export type ConceptField =
  | "title" | "projectType" | "genres" | "logline"
  | "summary" | "tone" | "themes" | "endingTypes";

export function isConceptFieldDirty(story: Story, field: ConceptField): boolean {
  const c = getActiveConceptDraft(story);
  const snap = c.savedSnapshot;
  if (!snap) return false;
  switch (field) {
    case "title":       return story.title !== snap.title;
    case "projectType": return story.projectType !== snap.projectType;
    case "genres":      return !arraysEqual(c.settings.genres, snap.settings.genres);
    case "logline":     return c.logline !== snap.logline;
    case "summary":     return c.concept.summary !== snap.concept.summary;
    case "tone":        return c.concept.tone !== snap.concept.tone;
    case "themes":      return !arraysEqual(c.concept.themes, snap.concept.themes);
    case "endingTypes": return !arraysEqual(c.settings.endingTypes, snap.settings.endingTypes);
  }
}

// ── Helpers: switch layer draft on active project draft ──

export function switchLayerDraft(story: Story, layer: LayerKey, draftId: string): Story {
  const now = new Date().toISOString();
  return {
    ...story,
    projectDrafts: story.projectDrafts.map(pd => {
      if (pd.id !== story.activeProjectDraftId) return pd;
      const key: "conceptDraftId" | "charactersDraftId" | "storyDraftId" | "scriptDraftId" =
        layer === "concept"    ? "conceptDraftId"    :
        layer === "characters" ? "charactersDraftId" :
        layer === "story"      ? "storyDraftId"      :
                                 "scriptDraftId";
      // When user explicitly switches a layer, reset that layer's synced marker
      // to "now" — the user knows the selection, so nothing's out of sync.
      const syncKey: "conceptSyncedAt" | "charactersSyncedAt" | "storySyncedAt" | undefined =
        layer === "concept"    ? "conceptSyncedAt" :
        layer === "characters" ? "charactersSyncedAt" :
        layer === "story"      ? "storySyncedAt" :
                                 undefined;
      const next: ProjectDraft = { ...pd, [key]: draftId, updatedAt: now };
      if (syncKey) (next as any)[syncKey] = now;
      return next;
    }),
    updatedAt: now,
  };
}

// ── Helpers: delete a layer draft ──
// Prevents deletion if any project draft references it, or if it's the last one.

export function deleteLayerDraft(story: Story, layer: LayerKey, draftId: string): Story {
  const pool = (
    layer === "concept"    ? story.conceptDrafts :
    layer === "characters" ? story.charactersDrafts :
    layer === "story"      ? story.storyDrafts :
                             story.scriptDrafts
  );
  if (pool.length <= 1) return story;
  const refKey: "conceptDraftId" | "charactersDraftId" | "storyDraftId" | "scriptDraftId" =
    layer === "concept"    ? "conceptDraftId" :
    layer === "characters" ? "charactersDraftId" :
    layer === "story"      ? "storyDraftId" :
                             "scriptDraftId";
  const referenced = story.projectDrafts.some(pd => pd[refKey] === draftId);
  if (referenced) return story; // refuse — caller should check first and warn

  const now = new Date().toISOString();
  const filtered = pool.filter((d: any) => d.id !== draftId);
  const key: "conceptDrafts" | "charactersDrafts" | "storyDrafts" | "scriptDrafts" =
    layer === "concept"    ? "conceptDrafts" :
    layer === "characters" ? "charactersDrafts" :
    layer === "story"      ? "storyDrafts" :
                             "scriptDrafts";
  return { ...story, [key]: filtered, updatedAt: now } as Story;
}

// ── Helpers: project drafts ──

export function createNewProjectDraft(story: Story): Story {
  const now = new Date().toISOString();
  const active = getActiveProjectDraft(story);
  const nextNumber = story.counters.project + 1;
  const newPD: ProjectDraft = {
    id: genId("pd"),
    number: nextNumber,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    conceptDraftId: active.conceptDraftId,
    charactersDraftId: active.charactersDraftId,
    storyDraftId: active.storyDraftId,
    scriptDraftId: active.scriptDraftId,
    savedConceptDraftId: active.conceptDraftId,
    savedCharactersDraftId: active.charactersDraftId,
    savedStoryDraftId: active.storyDraftId,
    savedScriptDraftId: active.scriptDraftId,
    conceptSyncedAt: now,
    charactersSyncedAt: now,
    storySyncedAt: now,
  };
  return {
    ...story,
    projectDrafts: [...story.projectDrafts, newPD],
    activeProjectDraftId: newPD.id,
    counters: { ...story.counters, project: nextNumber },
    updatedAt: now,
  };
}

export function switchProjectDraft(story: Story, id: string): Story {
  if (!story.projectDrafts.some(pd => pd.id === id)) return story;
  return {
    ...story,
    activeProjectDraftId: id,
    updatedAt: new Date().toISOString(),
  };
}

export function deleteProjectDraft(story: Story, id: string): Story {
  if (story.projectDrafts.length <= 1) return story;
  const filtered = story.projectDrafts.filter(pd => pd.id !== id);
  const nextActive = story.activeProjectDraftId === id
    ? filtered[0].id
    : story.activeProjectDraftId;
  return {
    ...story,
    projectDrafts: filtered,
    activeProjectDraftId: nextActive,
    updatedAt: new Date().toISOString(),
  };
}

// ── Sync state ──
// Compute which downstream layers are out-of-sync relative to the active project draft.

export interface LayerSyncState {
  charactersOutOfSync: boolean;
  storyOutOfSync: boolean;
  scriptOutOfSync: boolean;
}

export function getLayerSyncState(story: Story): LayerSyncState {
  const pd = getActiveProjectDraft(story);
  const concept    = getActiveConceptDraft(story);
  const characters = getActiveCharactersDraft(story);
  const storyDraft = getActiveStoryLayerDraft(story);

  const conceptStale    = pd.conceptSyncedAt    ? concept.updatedAt    > pd.conceptSyncedAt    : true;
  const charactersStale = pd.charactersSyncedAt ? characters.updatedAt > pd.charactersSyncedAt : true;
  const storyStale      = pd.storySyncedAt      ? storyDraft.updatedAt > pd.storySyncedAt      : true;

  return {
    charactersOutOfSync: conceptStale,
    storyOutOfSync: conceptStale || charactersStale,
    scriptOutOfSync: conceptStale || charactersStale || storyStale,
  };
}

// ── Cross-layer sync helpers ──
// "Empty" check: used by the Update-Other-Layers UI to decide whether to
// hide the trigger (source has nothing to derive from) and whether to
// overwrite-in-place or create a new draft when writing a target.

export function isLayerDraftEmpty(story: Story, layer: LayerKey): boolean {
  switch (layer) {
    case "concept": {
      // Concept is effectively never empty once a project exists: the
      // user was required to pick a title + genres at creation, so there
      // is always enough to derive from. Return false.
      return false;
    }
    case "characters": {
      const c = getActiveCharactersDraft(story);
      return !c || c.characters.length === 0;
    }
    case "story": {
      const s = getActiveStoryLayerDraft(story);
      if (!s) return true;
      if (story.projectType === "tv-show") {
        return (s.episodes ?? []).every(ep => ep.beats.length === 0);
      }
      return s.beats.length === 0;
    }
    case "script": {
      // Written scene prose is stored on beats (beat.sceneContent when
      // beat.status === "written"), not only on script.scenes. Treat the
      // Script layer as non-empty if either place has content.
      const sc = getActiveScriptDraft(story);
      const hasScenes = !!sc && sc.script.scenes.length > 0;
      if (hasScenes) return false;
      const sl = getActiveStoryLayerDraft(story);
      if (!sl) return true;
      const allBeats = story.projectType === "tv-show"
        ? (sl.episodes ?? []).flatMap(ep => ep.beats)
        : sl.beats;
      const hasWrittenBeat = allBeats.some(
        b => b.status === "written" && (b.sceneContent ?? "").trim() !== ""
      );
      return !hasWrittenBeat;
    }
  }
}

/**
 * Concept content that a sync is allowed to write. Deliberately omits
 * `title`, `projectType`, and `settings.genres` — those three are chosen
 * by the user at project creation and must never be overwritten by a sync.
 */
export interface ConceptContentPatch {
  logline?: string;
  summary?: string;
  tone?: string;
  themes?: string[];
  endingTypes?: EndingType[];
}

function applyConceptContent(draft: ConceptLayerDraft, patch: ConceptContentPatch): ConceptLayerDraft {
  return {
    ...draft,
    logline: patch.logline ?? draft.logline,
    concept: {
      ...draft.concept,
      summary: patch.summary ?? draft.concept.summary,
      tone:    patch.tone    ?? draft.concept.tone,
      themes:  patch.themes  ?? draft.concept.themes,
    },
    settings: {
      ...draft.settings,
      endingTypes: patch.endingTypes ?? draft.settings.endingTypes,
    },
  };
}

// Replace the content of the active layer draft in place (does NOT create
// a new draft). Used when the target draft is empty.

export function replaceActiveConceptContent(story: Story, patch: ConceptContentPatch): Story {
  const now = new Date().toISOString();
  const pd = getActiveProjectDraft(story);
  return {
    ...story,
    conceptDrafts: story.conceptDrafts.map(d =>
      d.id === pd.conceptDraftId ? { ...applyConceptContent(d, patch), updatedAt: now } : d
    ),
    updatedAt: now,
  };
}

export function replaceActiveCharactersContent(story: Story, characters: Character[]): Story {
  return updateCharactersDraft(story, { characters });
}

export function replaceActiveStoryContent(story: Story, beats: Beat[], episodes?: Episode[]): Story {
  const patch: Partial<StoryLayerDraft> = episodes !== undefined
    ? { beats, episodes }
    : { beats };
  return updateStoryLayerDraft(story, patch);
}

export function replaceActiveScriptContent(story: Story, scenes: Scene[]): Story {
  const current = getActiveScriptDraft(story);
  const now = new Date().toISOString();
  return updateScriptDraft(story, {
    script: {
      ...current.script,
      scenes,
      syncStatus: "synced",
      lastSyncedAt: now,
    },
  });
}

/**
 * Create a new layer draft (branching from the current active one) and
 * immediately populate its content from `content`. Activates the new draft.
 * Used when the target layer already has content and we want to preserve
 * the existing draft.
 */
export type LayerContent =
  | { kind: "concept";    patch: ConceptContentPatch }
  | { kind: "characters"; characters: Character[] }
  | { kind: "story";      beats: Beat[]; episodes?: Episode[] }
  | { kind: "script";     scenes: Scene[] };

export function createAndActivateLayerDraftWith(story: Story, content: LayerContent): Story {
  // Step 1: create a new draft (branches from active, becomes active).
  const branched =
    content.kind === "concept"    ? createNewConceptDraft(story) :
    content.kind === "characters" ? createNewCharactersDraft(story) :
    content.kind === "story"      ? createNewStoryLayerDraft(story) :
                                    createNewScriptDraft(story);
  // Step 2: apply the content to the now-active new draft.
  switch (content.kind) {
    case "concept":    return replaceActiveConceptContent(branched, content.patch);
    case "characters": return replaceActiveCharactersContent(branched, content.characters);
    case "story":      return replaceActiveStoryContent(branched, content.beats, content.episodes);
    case "script":     return replaceActiveScriptContent(branched, content.scenes);
  }
}

/**
 * High-level "apply a sync result" helper: given a target layer and a
 * derived content payload, either overwrite the active draft (if empty)
 * or create a new draft and activate it (if non-empty).
 */
export function applySyncResult(story: Story, content: LayerContent): Story {
  const layer: LayerKey = content.kind;
  if (isLayerDraftEmpty(story, layer)) {
    switch (content.kind) {
      case "concept":    return replaceActiveConceptContent(story, content.patch);
      case "characters": return replaceActiveCharactersContent(story, content.characters);
      case "story":      return replaceActiveStoryContent(story, content.beats, content.episodes);
      case "script":     return replaceActiveScriptContent(story, content.scenes);
    }
  }
  return createAndActivateLayerDraftWith(story, content);
}

// Mark a downstream layer as synced against current upstreams.
// Used when the user clicks "Keep current" / accepts the downstream as up-to-date.
export function markLayerSynced(story: Story, layer: "characters" | "story" | "script"): Story {
  const now = new Date().toISOString();
  return {
    ...story,
    projectDrafts: story.projectDrafts.map(pd => {
      if (pd.id !== story.activeProjectDraftId) return pd;
      const next = { ...pd, updatedAt: now };
      if (layer === "characters" || layer === "story" || layer === "script") {
        // Marking a downstream synced means "I accept current upstream state."
        // Reset all upstream synced timestamps to now for THIS layer's perspective.
        // Simpler: reset all synced timestamps.
        next.conceptSyncedAt = now;
        if (layer === "story" || layer === "script") {
          next.charactersSyncedAt = now;
        }
        if (layer === "script") {
          next.storySyncedAt = now;
        }
      }
      return next;
    }),
    updatedAt: now,
  };
}
