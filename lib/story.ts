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

/** The kind of short film the user is making. Drives the beat-skeleton
 *  flavor the prompts ask the model to produce, replacing the feature-
 *  style framework picker for shorts. Each value implies a different
 *  ending posture but all share the same flexible Situation → Pressure
 *  → Shift skeleton. Surfaced in the UI only when projectType="short". */
export type ShortStructure =
  | "complete" | "open-ended" | "proof-of-concept" | "slice-of-life" | "twist";

export type ProjectType = "feature" | "short" | "tv-show";

export interface StorySettings {
  /** Structural beat-skeleton the AI should use. `null` means the user
   *  hasn't picked one yet — downstream prompts should omit any
   *  framework-specific instructions and let the model choose what
   *  fits the concept/genre. Not defaulted at project creation. */
  framework: Framework | null;
  genres: Genre[];
  /** Stable ids from lib/subGenres.ts (e.g. "action:spy", "horror:slasher").
   *  Options are only surfaced in the UI when their parent genre is
   *  selected; unselecting a parent genre prunes its orphaned sub-genres. */
  subGenres: string[];
  /** "Make it similar to" — films/shows the user wants to echo, each
   *  tagged with which craft aspects (pacing, humor, etc.) to mirror. */
  references: Reference[];
  /** Writer style anchors, stored verbatim (e.g. "Aaron Sorkin"). The
   *  canonical list lives in lib/references.ts. */
  writerStyles: string[];
  vibe: string;
  unpredictability: number;  // 1-10
  darkness: number;          // 1-10
  pace: number;              // 1-10
  endingTypes: EndingType[];
  /** For projectType === "short" only. Target runtime in minutes.
   *  Drives the default scene count (≈ duration/1.5 clamped 6–12)
   *  in short-form prompts. `undefined` = unset → prompts default to
   *  a 12-minute / ~9-scene path. UI hides this row for non-short
   *  formats; stored values survive a temporary format swap. */
  duration?: number;
  /** For projectType === "tv-show" only. Number of episodes planned
   *  for the season. Drives the X-axis length of the Arcs timeline
   *  graph (one score per episode on every arc) AND, eventually, the
   *  AI's season-planning prompts. Clamped 1–30 by the normalizer;
   *  `undefined` = unset → arcs fall back to 7-episode defaults. */
  episodeCount?: number;
  /** For projectType === "short" only. Which kind of short the user
   *  is making — drives the beat-skeleton flavor the model produces.
   *  `null` = unset → prompts fall back to a generic Situation →
   *  Pressure → Shift skeleton. Mirrors `framework`'s null-as-unset
   *  pattern. */
  shortStructure?: ShortStructure | null;
  /** Free-text direction the user provides alongside each picker —
   *  their place to elaborate on tone/themes/framework/ending beyond
   *  the canned options. Empty string = none. Surfaced in the story
   *  bible next to the relevant picker so every downstream layer
   *  generation reads them as elaboration on the user's choices. */
  toneNote?: string;
  themesNote?: string;
  frameworkNote?: string;
  endingNote?: string;
}

export interface Reference {
  id: string;
  title: string;
  /** Short aspect labels from REFERENCE_ASPECTS in lib/references.ts
   *  (e.g. "pacing", "humor"). Stored verbatim. */
  aspects: string[];
}

export interface Concept {
  summary: string;
  tone: string;
  themes: string[];
  /** TV-only — high-level outline of the story arc that spans the
   *  whole season. Surfaces in the Concept tab as a free-text field
   *  on TV projects only. Every TV-targeted prompt injects this as
   *  a top-level block so individual episode generations stay in
   *  sync with the larger arc. Empty / undefined = no arc set;
   *  prompts gracefully omit the block. */
  seriesArc?: string;
}

export interface CharacterRelationship {
  characterId: string;
  description: string;
}

/** Character gender.
 *
 *  The UI exposes four canonical buckets plus free-text override. We
 *  keep the stored type as `string` so users who fill in something
 *  outside the canonical set (e.g. "genderfluid", a custom label for
 *  a non-human character) aren't forced through a dropdown. Empty
 *  string / undefined means "not yet set" — the sheet-close handler
 *  kicks off an AI name-based detection in that case.
 *
 *  Canonical tokens the UI offers directly:
 *    "male" | "female" | "nonbinary" | "unspecified"
 */
export type CharacterGender = string;

/** OpenAI gpt-4o-mini-tts voice IDs the app supports today.
 *  Kept in sync with `CHARACTER_VOICES` + `"onyx"` in lib/scriptParse.ts.
 *  Defined here (not in scriptParse) so Character can reference it
 *  without dragging the screenplay parser into every story-layer
 *  import. */
export type CharacterAiVoice =
  | "alloy" | "echo" | "fable" | "nova" | "onyx" | "shimmer";

export interface Character {
  id: string;
  name: string;
  role: string;
  archetype: string;
  /** Optional — new field. Stored as free-text; see `CharacterGender`.
   *  Populated either by direct user selection, or by AI auto-detect
   *  on sheet-close when the user didn't set it explicitly. */
  gender?: CharacterGender;
  /** Optional — free-text age. Accepts numerics ("26") and language
   *  ("around 30", "ancient"). Lives between gender and role in the
   *  edit form's flow. Empty/missing = unset. */
  age?: string;
  backstory: string;
  motivations: string;
  flaws: string;
  want: string;
  need: string;
  relationships: CharacterRelationship[];
  /** Free-text voice direction, e.g. "hushed, menacing, mid-30s".
   *  Read aloud passes this string to TTS as the `instructions`
   *  parameter so the model adopts the described delivery. Doubles
   *  as a gender-keyword hint when `aiVoice` isn't explicitly set. */
  voice: string;
  /** Explicit AI voice pick from the read-aloud picker. `null`/missing
   *  means "Auto" — fall back to the name-hash + `voice`-keyword
   *  heuristic so unset characters still sound consistent. */
  aiVoice?: CharacterAiVoice | null;
  arc: string;
  notes: string;
  /** Sticky "we already tried" sentinel for the auto-image-generation
   *  effect. Set to true the first time auto-gen fires for this
   *  character — regardless of whether the API call succeeded, failed,
   *  or aborted — and the manual Generate / Upload paths set it too.
   *  Once true, the auto-gen effect skips this character forever, even
   *  if the thumbnail later goes missing from the row (silent save
   *  failure, etc.). Manual regen from the edit sheet still works.
   *  Older saves without this field default to undefined (falsy) — for
   *  characters that have a thumbnail this is fine (the thumbnail
   *  check already short-circuits auto-gen); for thumbnail-less older
   *  characters this is the ONLY path that fires a first attempt. */
  imageGenAttempted?: boolean;
  /** TV-only: id of the Episode this character was created in. Set on
   *  add and never re-stamped, so the creator-episode is stable. The
   *  Characters tab uses it to lock cross-episode edits — a character
   *  introduced in Episode 2 can't be edited or deleted while the user
   *  is viewing Episode 1, and vice versa. `undefined` means the
   *  character predates this rule (legacy projects) — treat as "owned
   *  by the pilot episode" via the storage migration in normalizeCharacter. */
  createdInEpisodeId?: string;
  /** Cinematic AI-generated character portrait. 4:5 vertical crop,
   *  stored as a compressed JPEG data URL (~50–80KB). Generated via
   *  /api/generate-character-image using a fixed style prompt + the
   *  character's free-text description so portraits stay visually
   *  consistent across a project's cast. */
  thumbnail?: string;
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
  /** IDs of characters who appear in this beat. Populated from the
   *  Characters-layer active draft. Optional so older saved beats
   *  (pre-feature) still deserialize cleanly. */
  characterIds?: string[];
  /** Per-scene Twist dial (1-10). Hint to the AI for how surprising
   *  this scene's reveal/turn should be. `undefined` = unset → prompts
   *  fall back to the project-level defaults. */
  twist?: number;
  /** Per-scene Weirdness dial (1-10). Hint to the AI for how strange
   *  the scene's tone/imagery should run. `undefined` = unset. */
  weirdness?: number;
  status: BeatStatus;
  sceneContent?: string;
  /** Free-text location for the scene, e.g. "Apartment", "Forest
   *  near the highway", or "INT. Office". Combined with `timeOfDay`
   *  by `formatSlugline()` (lib/story.ts) into a screenplay-style
   *  slugline ("INT. APARTMENT - NIGHT"). When the user's location
   *  doesn't start with INT/EXT, the formatter prepends "INT." by
   *  default. Empty/missing = no heading row rendered. */
  location?: string;
  /** Free-text time-of-day for the scene, e.g. "Night", "Day",
   *  "Sunset", "Continuous". Combined with `location` to produce
   *  the slugline. Empty/missing renders without the " - TIME" tail. */
  timeOfDay?: string;
  /** Explicit scene length in minutes (whole or fractional). When
   *  set, takes precedence over the word-count-based estimate in
   *  the Story-tab card's duration chip. `undefined` = unset →
   *  card falls back to estimating from `sceneContent` words. */
  lengthMinutes?: number;
  /** AI-generated cinematic scene thumbnail (7:5 painted still),
   *  stored as a base64 data URL the same way Character.thumbnail is.
   *  Optional — produced by /api/generate-scene-image after a beat is
   *  saved with at least a name, or by bulk sync via Add All Scenes. */
  thumbnail?: string;
  /** Same sticky sentinel as `Character.imageGenAttempted` — set true
   *  the first time auto-gen fires for this beat (success or failure),
   *  blocks further auto-attempts on subsequent reloads. Manual gen
   *  from the beat sheet bypasses this. */
  imageGenAttempted?: boolean;
}

/** Canonical episode-archetype tags. Each leans the AI's beat
 *  generation toward a different structural template. Empty /
 *  undefined → no archetype hint; the model uses a generic episode
 *  shape. New values can be added without breaking older episodes
 *  since the field is optional. */
export type EpisodeArchetype =
  | "case-of-the-week"
  | "myth-arc"
  | "bottle"
  | "character-study"
  | "flashback"
  | "season-premiere"
  | "season-finale";

export interface Episode {
  id: string;
  title: string;
  number: number;
  beats: Beat[];
  /** Optional per-episode logline / 1-line synopsis. Displayed on
   *  the episode card in the Episodes tab. Independent of the
   *  project-level Concept logline. */
  logline?: string;
  /** Optional archetype tag — feeds the per-episode beat-generation
   *  prompt with a structural template hint (procedural vs. myth
   *  arc vs. bottle vs. character study, etc.). Defaults to
   *  undefined; the model picks a generic shape in that case. */
  archetype?: EpisodeArchetype;
  /** Optional per-episode cover thumbnail (URL or data URL). Falls
   *  back to a placeholder when missing. */
  thumbnail?: string;
  /** Mirrors Character/Beat — set true the first time an image
   *  generation attempt has been made (even if it failed). Prevents
   *  the auto-fill effect from re-firing across reloads. */
  imageGenAttempted?: boolean;
  /** Last-modified marker — used in the "Updated 2d ago" label on
   *  the episode card. Bumps whenever any field on the episode (or
   *  any beat inside it) changes. */
  updatedAt?: string;
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
  /** AI-generated short version of the logline (≤120 chars). Used on
   *  the desktop project hero as the small-caps description under the
   *  title. Optional — falls back to a truncated logline if absent.
   *  Auto-generated when the desktop hero mounts with a non-empty
   *  logline and no tagline yet. */
  tagline?: string;
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

/**
 * Episodes layer draft — top-level for TV projects. Mirrors
 * StoryLayerDraft's shape (id/number/timestamps + a content list).
 * The content list is `episodes`; each Episode carries its own
 * beats. Drill-down: clicking an episode in the Episodes tab opens
 * the per-episode Story tab, which scopes its work to that
 * episode's beats inside the active episodes draft.
 *
 * MIGRATION: TV projects created before this layer existed stored
 * episodes inside `StoryLayerDraft.episodes`. `normalizeStory` in
 * lib/storage.ts detects that shape and lifts the episodes to an
 * `EpisodesLayerDraft[]` on load (one episodes-draft per legacy
 * story-draft that carried episodes). The legacy `episodes` field
 * on StoryLayerDraft is preserved for back-compat reads but new
 * code should always use `Story.episodesDrafts`.
 */
export interface EpisodesLayerDraft {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  episodes: Episode[];
}

/* ── Arcs layer (TV-only Phase 1 UI) ───────────────────────────────
   The "Archs" tab on TV projects holds the season's story arcs — a
   list of subplot cards each plotting an intensity curve across the
   season's episodes. Arcs are independent of episodes mechanically
   (they don't drive episode generation yet) — this is a planning
   surface the writer fills in, mostly by hand for now.

   Each arc has:
     - type: one of the 20 canonical arc types (see ARC_TYPES)
     - title: user-supplied display name (e.g., "Walt's Descent")
     - description: 1-sentence summary of the arc's shape
     - color: hex string used by both the arc card's left-edge marker
       AND the SVG curve in the timeline graph. Picked from a curated
       palette at create-time; the user can change it later.
     - scores: number[] of length = active episode count. Each value
       is the arc's intensity at that episode (1 = order, 10 = chaos).
       New scores default to a sensible flat-ish baseline (see emptyArc). */

export const ARC_TYPES = [
  "main-plot",
  "character",
  "relationship",
  "subplot",
  "secrecy",
  "investigation",
  "mystery-reveal",
  "antagonist",
  "world",
  "theme",
  "power",
  "moral-descent",
  "redemption",
  "rise",
  "fall",
  "survival",
  "revenge",
  "love-romance",
  "family",
  "identity",
] as const;

export type ArcType = typeof ARC_TYPES[number];

/** Human-facing label for each arc type. Mirrors the user-spec'd
 *  copy. Used by both the arc-card type chip and the Add Arc type
 *  picker. */
export const ARC_TYPE_LABELS: Record<ArcType, string> = {
  "main-plot":      "Main Plot Arc",
  "character":      "Character Arc",
  "relationship":   "Relationship Arc",
  "subplot":        "Subplot Arc",
  "secrecy":        "Secrecy Arc",
  "investigation":  "Investigation Arc",
  "mystery-reveal": "Mystery / Reveal Arc",
  "antagonist":     "Antagonist Arc",
  "world":          "World Arc",
  "theme":          "Theme Arc",
  "power":          "Power Arc",
  "moral-descent":  "Moral Descent / Corruption Arc",
  "redemption":     "Redemption Arc",
  "rise":           "Rise Arc",
  "fall":           "Fall Arc",
  "survival":       "Survival Arc",
  "revenge":        "Revenge Arc",
  "love-romance":   "Love / Romance Arc",
  "family":         "Family Arc",
  "identity":       "Identity Arc",
};

/** Curated arc palette — picked for distinguishability on the
 *  light cream app background. New arcs are assigned colors in
 *  order (1st arc → index 0, 2nd → index 1, etc.). When the user
 *  has more arcs than colors we cycle. */
export const ARC_COLORS: string[] = [
  "#4A6FA5", // blue        — main plot default
  "#E55757", // red
  "#D86A9F", // pink
  "#6FAD8F", // green
  "#E8C551", // yellow
  "#6BA6D9", // light blue
  "#A87FB8", // purple
  "#E89C5D", // orange
  "#4F8B9B", // teal
  "#B85C3C", // brown
  "#8AB85C", // lime
  "#C77BD9", // magenta
];

/** A key turning point attached to a specific spot along an arc.
 *  Rendered as a diamond marker on the arc's curve (always visible,
 *  regardless of hover state) and as a row at the bottom of the
 *  arc card. The user creates one by clicking anywhere on the curve
 *  in the Arcs tab — the click position becomes `position`. */
export interface ArcMoment {
  id: string;
  /** Fractional episode position along the X axis of the graph.
   *  0 = exactly at episode 1's marker, 1 = exactly at episode 2's
   *  marker, episodeCount - 1 = the last episode. Non-integer values
   *  ("between EP3 and EP4") are allowed and rendered at the
   *  proportional pixel offset between adjacent episode columns. */
  position: number;
  /** Free-text turning-point description. Used when the user wrote a
   *  moment inline. May be empty when `momentId` is set (the linked
   *  saved Moment carries the body text). */
  text: string;
  /** Optional link to a saved Moment (from the user-wide Moments
   *  pool — `moments` state on the Projects page). When set, the
   *  UI prefers the linked Moment's `text` for display so edits to
   *  the canonical saved idea propagate to this arc marker. */
  momentId?: string;
}

export interface Arc {
  id: string;
  type: ArcType;
  title: string;
  description: string;
  color: string;
  /** Intensity at each episode. `scores.length` should equal the
   *  active episodes-draft's episode count; emptyArc / addArcToActive-
   *  Draft handle the alignment. Each value is 1-10. */
  scores: number[];
  /** Optional turning-point markers attached to specific points along
   *  this arc's curve. Always rendered on the graph (unlike intensity
   *  nodes which only show on hover) so the writer can see the
   *  season's key beats at a glance. */
  moments?: ArcMoment[];
  /** When set, this arc belongs to a specific character — managed
   *  from the character popup's "Character Arcs" section AS WELL AS
   *  from the Arcs tab popup. Only meaningful when `type === "character"`.
   *  References a Character.id in the active characters draft. The
   *  Arcs tab is the canonical store; the character popup is an
   *  alternate editor for the same Arc entries. */
  characterId?: string;
  /** Whether the user has explicitly set per-episode intensity values
   *  for this arc. Character arcs default to `false` so they don't
   *  pollute the timeline graph before the writer has decided how the
   *  arc plays out across the season — the ArcGraph only renders a
   *  curve for character arcs once this flips true. Non-character
   *  arcs (main-plot, mystery, etc.) are always considered set since
   *  the Arcs-tab popup forces the scores row to be filled in at
   *  creation time. */
  intensitySet?: boolean;
}

export interface ArcsLayerDraft {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  arcs: Arc[];
}

export interface StoryLayerDraft {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  beats: Beat[];
  /** @deprecated TV projects now keep episodes on Story.episodesDrafts.
   *  Field kept for back-compat reads of legacy data; the normalizer
   *  lifts it during load. New writes should not touch this. */
  episodes?: Episode[];
  ingredients: Ingredient[];
  snippets: Snippet[];
  /** Optional free-text direction the user provides to steer beat/scene
   *  generation. Read by prompt builders for `generate_beats` and
   *  `sync_*_to_story`. Persisted on the draft so the value survives
   *  navigation; carried into branched drafts (so re-syncs can re-use it)
   *  and into partner-preview clones. */
  direction?: string;
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
  /** TV-only. References the active EpisodesLayerDraft for this
   *  project draft. Optional on the type so existing feature
   *  projects don't need migration; the normalizer fills it in
   *  for TV projects on load. */
  episodesDraftId?: string;
  /** TV-only. References the active ArcsLayerDraft. Same back-compat
   *  treatment as `episodesDraftId` — optional, filled in by the
   *  normalizer for TV projects on load. */
  arcsDraftId?: string;
  // Saved layer IDs at time of last save — used to detect per-tab
  // "has this layer changed since save" indicators.
  savedConceptDraftId?: string;
  savedCharactersDraftId?: string;
  savedStoryDraftId?: string;
  savedScriptDraftId?: string;
  savedEpisodesDraftId?: string;
  savedArcsDraftId?: string;
  // Sync markers: ISO timestamps of when each upstream layer was "synced"
  // into this project draft. If upstream.updatedAt > this marker, the
  // downstream is considered out-of-sync.
  conceptSyncedAt?: string;
  charactersSyncedAt?: string;
  storySyncedAt?: string;
  episodesSyncedAt?: string;
  arcsSyncedAt?: string;
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
  /** TV-only layer. Populated by the normalizer for `projectType ===
   *  "tv-show"`; absent on feature projects (which have no episodes
   *  concept). */
  episodesDrafts?: EpisodesLayerDraft[];
  /** TV-only layer. Stores the user's "Archs" tab content — a list
   *  of season story arcs each carrying a per-episode intensity
   *  score array. Initialized empty (one draft, zero arcs) by the
   *  normalizer on TV projects; absent on feature/short projects. */
  arcsDrafts?: ArcsLayerDraft[];
  projectDrafts: ProjectDraft[];
  activeProjectDraftId: string;
  counters: {
    concept: number;
    characters: number;
    story: number;
    script: number;
    project: number;
    /** TV-only — used by `createNewLayerDraft` when forking an
     *  episodes draft. Optional so feature projects don't carry
     *  a meaningless field. */
    episodes?: number;
    /** TV-only — same shape as `episodes`. Increments when a new
     *  arcs draft is forked. */
    arcs?: number;
  };
  updatedAt: string;
  /**
   * Last time the USER made a direct content edit to this story.
   * Distinct from `updatedAt` (which bumps on EVERY DB write — including
   * background paths like thumbnail regen, partner-sync incoming, and
   * autosave of normalize-only changes). Used as the sort key for the
   * Projects grid so cards don't shuffle every time the auth listener
   * re-fires on tab focus and triggers a normalize-only save.
   *
   * Bumped exclusively inside the layer-draft update helpers
   * (`updateConceptDraft` / `updateCharactersDraft` / `updateStoryLayerDraft`
   * / `updateScriptDraft` / `updateEpisodesDraft` / `updateArcsDraft`),
   * which is the choke point every typed/clicked content change flows
   * through. Optional + fallback-to-`updatedAt` on the sort makes legacy
   * rows behave identically until the user touches them once.
   */
  lastUserEditAt?: string;
  /**
   * When set, this project is shared with another user and the value
   * is their auth.users.id. The partner's own row (a separate DB
   * row sharing this project id) carries the reverse pointer back
   * to us. For single-user projects this is undefined — the whole
   * collaboration UI tree is gated on this field being truthy, so
   * solo projects get zero visual or behavioral difference.
   */
  collaboratorUserId?: string;
}

export type LayerKey = "concept" | "characters" | "story" | "script" | "episodes" | "arcs";

// ── Default factories ──

export function emptyConceptDraft(id: string, number: number, ts: string): ConceptLayerDraft {
  return {
    id, number, createdAt: ts, updatedAt: ts, savedAt: ts,
    logline: "",
    settings: {
      // Intentionally unset — the user picks Structure explicitly from
      // the Concept tab. Defaulting to a framework biased every new
      // project toward Save the Cat even when the writer had no opinion.
      framework: null,
      genres: [],
      subGenres: [],
      references: [],
      writerStyles: [],
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

/** TV-only — empty Episodes layer draft. Mirrors the shape of
 *  emptyStoryLayerDraft. New TV projects start with one such draft
 *  containing no episodes; the user adds the first episode from the
 *  Episodes tab. */
export function emptyEpisodesDraft(id: string, number: number, ts: string): EpisodesLayerDraft {
  return { id, number, createdAt: ts, updatedAt: ts, savedAt: ts, episodes: [] };
}

/** TV-only — empty Arcs layer draft. One per project at creation
 *  time, zero arcs inside. The Archs tab populates it from there. */
export function emptyArcsLayerDraft(id: string, number: number, ts: string): ArcsLayerDraft {
  return { id, number, createdAt: ts, updatedAt: ts, savedAt: ts, arcs: [] };
}

/** Build a fresh Arc record. The first arc on a project defaults
 *  to `main-plot` (the spine) — caller signals this by passing
 *  `isFirst: true`. Scores are initialized to a neutral middle-of-
 *  the-road shape so the curve is rendered immediately without
 *  forcing the user to set every point. `episodeCount` should be
 *  the current active episodes-draft's length; if zero (no
 *  episodes yet) we default to a placeholder 7-point baseline. */
export function emptyArc(opts: {
  id: string;
  type: ArcType;
  title?: string;
  description?: string;
  color: string;
  episodeCount: number;
}): Arc {
  const n = Math.max(opts.episodeCount, 7);
  // Default shape: gentle climb from order (3) to chaos (8) across
  // the season — reads as "things escalate." Writers will edit.
  const scores: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    scores.push(Math.round(3 + t * 5));
  }
  return {
    id: opts.id,
    type: opts.type,
    title: opts.title ?? "",
    description: opts.description ?? "",
    color: opts.color,
    scores,
  };
}

/** TV-only. Returns the active ArcsLayerDraft (matched by
 *  ProjectDraft.arcsDraftId) or null when the project doesn't
 *  have arcs yet (legacy load before the normalizer ran, or a
 *  non-TV project). */
export function getActiveArcsDraft(story: Story): ArcsLayerDraft | null {
  if (!story.arcsDrafts || story.arcsDrafts.length === 0) return null;
  const pd = getActiveProjectDraft(story);
  if (!pd) return story.arcsDrafts[0] ?? null;
  return (
    story.arcsDrafts.find(d => d.id === pd.arcsDraftId) ??
    story.arcsDrafts[0] ??
    null
  );
}

/** TV-only — patch the active ArcsLayerDraft. Mirrors the
 *  episodes/story patch helpers; bumps updatedAt on the draft. */
export function updateArcsDraft(story: Story, patch: Partial<ArcsLayerDraft>): Story {
  if (!story.arcsDrafts || story.arcsDrafts.length === 0) return story;
  const active = getActiveArcsDraft(story);
  if (!active) return story;
  const ts = new Date().toISOString();
  return {
    ...story,
    arcsDrafts: story.arcsDrafts.map(d =>
      d.id === active.id ? { ...d, ...patch, updatedAt: ts } : d
    ),
    updatedAt: ts,
    // User content edit — bump the sort key for the Projects grid.
    lastUserEditAt: ts,
  };
}

/** Returns the canonical episode count for the Arcs tab — the
 *  number of slots on the X-axis of the timeline graph and the
 *  length of every arc's `scores` array. Priority order:
 *    1. concept.settings.episodeCount (user-specified)
 *    2. getActiveEpisodesDraft length (actual episodes created)
 *    3. 7 (default placeholder so the graph isn't empty)
 *  TV-only — callers should generally only invoke this when
 *  projectType === "tv-show". */
export function getEpisodeCountForArcs(story: Story): number {
  const fromConcept = getActiveConceptDraft(story)?.settings?.episodeCount;
  if (typeof fromConcept === "number" && fromConcept >= 1) return fromConcept;
  const fromEpisodes = getActiveEpisodesDraft(story)?.episodes.length ?? 0;
  if (fromEpisodes >= 1) return fromEpisodes;
  return 7;
}

/** Add an Arc to the active arcs draft. The first arc on the
 *  project (active draft has zero arcs) is forced to `main-plot`
 *  regardless of what the caller passed — per spec ("the first arc
 *  will be defaulted as it is the main story arch"). Otherwise the
 *  caller's `type` is honored. Color is auto-assigned from
 *  ARC_COLORS based on the index of the new arc, cycling when we
 *  run out. Optional `scores` override — when present, replaces
 *  the default 3→8 gentle climb (used by the popup's per-episode
 *  score inputs). */
export function addArcToActiveDraft(
  story: Story,
  input: {
    type: ArcType;
    title?: string;
    description?: string;
    scores?: number[];
    /** Optional — set when adding from the character popup so the new
     *  arc is owned by that character. Type is forced to "character"
     *  if a characterId is provided (regardless of `input.type`) since
     *  character ownership and the "character" category are 1:1. */
    characterId?: string;
    /** When true, mark this arc as having user-set intensity (its
     *  curve will render in the timeline graph). Arcs-tab adds pass
     *  `true` here so the new curve is visible immediately. Character-
     *  popup adds pass the flag based on whether the user filled in
     *  the optional intensity row. */
    intensitySet?: boolean;
  },
): Story {
  const active = getActiveArcsDraft(story);
  if (!active) return story;
  const isFirst = active.arcs.length === 0;
  // A characterId forces the arc into the "character" category, regardless
  // of what was passed — the two concepts are 1:1 by design.
  const requestedType: ArcType = input.characterId ? "character" : input.type;
  const type: ArcType = isFirst ? "main-plot" : requestedType;
  const color = ARC_COLORS[active.arcs.length % ARC_COLORS.length];
  const episodeCount = getEpisodeCountForArcs(story);
  const id = `arc_${Math.random().toString(36).slice(2, 10)}`;
  const arc = emptyArc({
    id,
    type,
    title: input.title?.trim() || ARC_TYPE_LABELS[type],
    description: input.description?.trim() || "",
    color,
    episodeCount,
  });
  if (input.scores && input.scores.length > 0) {
    arc.scores = input.scores
      .slice(0, episodeCount)
      .map(s => Math.max(1, Math.min(10, Math.round(s))));
    while (arc.scores.length < episodeCount) arc.scores.push(5);
  }
  if (input.characterId) arc.characterId = input.characterId;
  // Default `intensitySet`: character arcs default to FALSE (gated
  // out of the graph until the user fills in the intensity row);
  // every other arc type defaults to TRUE since the Arcs-tab popup
  // always asks for scores at creation time.
  arc.intensitySet = input.intensitySet ?? type !== "character";
  return updateArcsDraft(story, { arcs: [...active.arcs, arc] });
}

/** Patch a specific arc inside the active arcs draft. Used by
 *  the Arc edit popup. Caller passes `arcId` + a partial Arc;
 *  matched-by-id arcs are merged with the patch, scores are
 *  clamped 1–10 if present. */
export function updateArcInActiveDraft(
  story: Story,
  arcId: string,
  patch: Partial<Pick<Arc, "type" | "title" | "description" | "color" | "scores" | "characterId" | "intensitySet">>,
): Story {
  const active = getActiveArcsDraft(story);
  if (!active) return story;
  return updateArcsDraft(story, {
    arcs: active.arcs.map(a => {
      if (a.id !== arcId) return a;
      const next: Arc = { ...a, ...patch };
      if (patch.scores) {
        next.scores = patch.scores.map(s => Math.max(1, Math.min(10, Math.round(s))));
      }
      return next;
    }),
  });
}

/** Remove a specific arc from the active arcs draft. */
export function deleteArcFromActiveDraft(story: Story, arcId: string): Story {
  const active = getActiveArcsDraft(story);
  if (!active) return story;
  return updateArcsDraft(story, {
    arcs: active.arcs.filter(a => a.id !== arcId),
  });
}

/** Append a moment marker to a specific arc. Caller supplies the
 *  position (fractional episode index) — usually derived from where
 *  the user clicked on the curve. */
export function addMomentToArc(
  story: Story,
  arcId: string,
  input: { position: number; text?: string; momentId?: string },
): Story {
  const active = getActiveArcsDraft(story);
  if (!active) return story;
  const id = `mom_${Math.random().toString(36).slice(2, 10)}`;
  const moment: ArcMoment = {
    id,
    position: input.position,
    text: input.text?.trim() ?? "",
    ...(input.momentId ? { momentId: input.momentId } : {}),
  };
  return updateArcsDraft(story, {
    arcs: active.arcs.map(a =>
      a.id === arcId
        ? { ...a, moments: [...(a.moments ?? []), moment] }
        : a,
    ),
  });
}

/** Patch a moment on a specific arc. Used by the Edit Moment popup. */
export function updateMomentOnArc(
  story: Story,
  arcId: string,
  momentId: string,
  patch: Partial<Pick<ArcMoment, "position" | "text" | "momentId">>,
): Story {
  const active = getActiveArcsDraft(story);
  if (!active) return story;
  return updateArcsDraft(story, {
    arcs: active.arcs.map(a => {
      if (a.id !== arcId) return a;
      const moments = (a.moments ?? []).map(m =>
        m.id === momentId ? { ...m, ...patch } : m,
      );
      return { ...a, moments };
    }),
  });
}

/** Remove a moment marker from a specific arc. */
export function deleteMomentFromArc(
  story: Story,
  arcId: string,
  momentId: string,
): Story {
  const active = getActiveArcsDraft(story);
  if (!active) return story;
  return updateArcsDraft(story, {
    arcs: active.arcs.map(a =>
      a.id === arcId
        ? { ...a, moments: (a.moments ?? []).filter(m => m.id !== momentId) }
        : a,
    ),
  });
}

/** Pad or trim every arc's `scores` array in the active draft to
 *  the given length. Called when the user changes episodeCount on
 *  the Concept tab — keeps each arc's curve continuous across the
 *  new axis (last-value padding when extending; trim from the end
 *  when shortening). */
// NON-DESTRUCTIVE on shrink. When the user lowers the episode count in
// Concept, we keep the entire stored scores array — the graph and edit
// popup just read the first N entries. Reasons:
//   1) Per spec: "If the episodes are updated to less, keep the episode
//      intensity of the previous set episodes under the arch the same."
//   2) The user might be mid-typing a multi-digit number ("10" → "1" →
//      "10"). The intermediate single-digit value would otherwise
//      truncate scores destructively before the "10" stroke could
//      restore them.
// When the user RAISES the count, we still pad with the last set value
// so the curve extends flat into the new episodes rather than collapsing.
export function normalizeArcScoresToCount(story: Story, n: number): Story {
  const active = getActiveArcsDraft(story);
  if (!active || active.arcs.length === 0) return story;
  return updateArcsDraft(story, {
    arcs: active.arcs.map(a => {
      const scores = [...a.scores];
      if (scores.length >= n) return a; // keep tail — never truncate
      const padValue = scores[scores.length - 1] ?? 5;
      while (scores.length < n) scores.push(padValue);
      return { ...a, scores };
    }),
  });
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

/** TV-only. Returns the active EpisodesLayerDraft (the one
 *  referenced by the active project draft's `episodesDraftId`).
 *  Returns null for feature projects (no episodes concept) and for
 *  legacy TV projects that haven't been normalized yet — callers
 *  should handle the null case gracefully. */
export function getActiveEpisodesDraft(story: Story): EpisodesLayerDraft | null {
  if (!story.episodesDrafts || story.episodesDrafts.length === 0) return null;
  const pd = getActiveProjectDraft(story);
  return story.episodesDrafts.find(d => d.id === pd.episodesDraftId) ?? story.episodesDrafts[0];
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
    lastUserEditAt: now,
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
    lastUserEditAt: now,
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
    lastUserEditAt: now,
  };
}

/** TV-only — patch the active EpisodesLayerDraft. Mirrors
 *  updateStoryLayerDraft. No-ops cleanly when `episodesDrafts` is
 *  empty (returns the story unchanged) so feature projects that
 *  accidentally end up here don't crash. */
export function updateEpisodesDraft(story: Story, patch: Partial<EpisodesLayerDraft>): Story {
  if (!story.episodesDrafts || story.episodesDrafts.length === 0) return story;
  const now = new Date().toISOString();
  const pd = getActiveProjectDraft(story);
  const targetId = pd.episodesDraftId ?? story.episodesDrafts[0].id;
  return {
    ...story,
    episodesDrafts: story.episodesDrafts.map(d =>
      d.id === targetId ? { ...d, ...patch, updatedAt: now } : d
    ),
    updatedAt: now,
    lastUserEditAt: now,
  };
}

/** Replace one episode within the active episodes draft. Bumps
 *  episode.updatedAt so the "Updated 2d ago" label on the card
 *  reflects the latest change. */
export function upsertEpisodeInActiveDraft(story: Story, episode: Episode): Story {
  const active = getActiveEpisodesDraft(story);
  if (!active) return story;
  const now = new Date().toISOString();
  const nextEpisode: Episode = { ...episode, updatedAt: now };
  const exists = active.episodes.some(e => e.id === episode.id);
  const nextEpisodes = exists
    ? active.episodes.map(e => (e.id === episode.id ? nextEpisode : e))
    : [...active.episodes, nextEpisode];
  return updateEpisodesDraft(story, { episodes: nextEpisodes });
}

/** Add a new episode to the active episodes draft. Auto-numbers
 *  based on the current count; caller supplies title + (optional)
 *  logline. Returns the updated story; the new episode's id is on
 *  the last entry of the active draft. */
export function addEpisodeToActiveDraft(
  story: Story,
  init: { title?: string; logline?: string; beats?: Beat[]; archetype?: EpisodeArchetype } = {},
): Story {
  const active = getActiveEpisodesDraft(story);
  if (!active) return story;
  const now = new Date().toISOString();
  const ep: Episode = {
    id: genId("ep"),
    title: init.title ?? "",
    number: active.episodes.length + 1,
    beats: init.beats ?? [],
    logline: init.logline,
    archetype: init.archetype,
    updatedAt: now,
  };
  return updateEpisodesDraft(story, { episodes: [...active.episodes, ep] });
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
    lastUserEditAt: now,
  };
}

// ── Helpers: create new layer draft ──
// Snapshot current active layer content as a new draft, point active project draft at it.

/**
 * Compute the next draft number by taking max(existing numbers) + 1.
 *
 * We intentionally derive this from the *surviving* drafts rather than from
 * a monotonically-growing counter. If the user has Draft 1, Draft 2, Draft 3
 * and deletes Draft 3, the next created draft should be Draft 3 again — the
 * visible sequence stays contiguous instead of jumping to Draft 4 and leaving
 * a gap. A counter-based approach would produce "Draft 1, Draft 2, Draft 4",
 * which reads as if a draft is missing.
 *
 * If an earlier draft is deleted (e.g., Draft 2 in a 1/2/3 list) max + 1
 * still yields 4 → "Draft 1, Draft 3, Draft 4", which matches the user's
 * phrasing: continue the sequence based off the *last* numbered draft.
 */
function nextDraftNumber(drafts: { number: number }[]): number {
  return drafts.reduce((m, d) => (d.number > m ? d.number : m), 0) + 1;
}

export function createNewConceptDraft(story: Story): Story {
  const now = new Date().toISOString();
  const active = getActiveConceptDraft(story);
  const nextNumber = nextDraftNumber(story.conceptDrafts);
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
  const nextNumber = nextDraftNumber(story.charactersDrafts);
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
  const nextNumber = nextDraftNumber(story.storyDrafts);
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
  const nextNumber = nextDraftNumber(story.scriptDrafts);
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

/**
 * Create a fresh *empty* layer draft for the given layer and make it the
 * active draft on the current project draft. Sibling to
 * `createNewLayerDraft`, which clones the active draft's content forward
 * (that's the "Duplicate" semantic). This is the "New Draft" semantic —
 * start blank.
 *
 * Concept is a special case: genres are project-identity-level (chosen
 * at project creation) so they carry forward onto the new Concept's
 * settings. Everything else — logline, summary, tone, themes,
 * framework, sub-genres, references, writer styles, vibe, numeric
 * sliders, ending types — starts blank.
 *
 * For Characters / Story / Script, "empty" means no characters, no
 * beats/episodes/ingredients/snippets, and no scenes respectively.
 */
export function createEmptyLayerDraft(story: Story, layer: LayerKey): Story {
  const now = new Date().toISOString();
  switch (layer) {
    case "concept": {
      const prevGenres = getActiveConceptDraft(story).settings.genres;
      const draft = emptyConceptDraft(
        genId("cd"),
        nextDraftNumber(story.conceptDrafts),
        now,
      );
      draft.settings = { ...draft.settings, genres: [...prevGenres] };
      return {
        ...story,
        conceptDrafts: [...story.conceptDrafts, draft],
        counters: {
          ...story.counters,
          concept: Math.max(story.counters.concept, draft.number),
        },
        projectDrafts: story.projectDrafts.map(pd =>
          pd.id === story.activeProjectDraftId
            ? { ...pd, conceptDraftId: draft.id, conceptSyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "characters": {
      const draft = emptyCharactersDraft(
        genId("chd"),
        nextDraftNumber(story.charactersDrafts),
        now,
      );
      return {
        ...story,
        charactersDrafts: [...story.charactersDrafts, draft],
        counters: {
          ...story.counters,
          characters: Math.max(story.counters.characters, draft.number),
        },
        projectDrafts: story.projectDrafts.map(pd =>
          pd.id === story.activeProjectDraftId
            ? { ...pd, charactersDraftId: draft.id, charactersSyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "story": {
      const draft = emptyStoryLayerDraft(
        genId("sd"),
        nextDraftNumber(story.storyDrafts),
        now,
      );
      return {
        ...story,
        storyDrafts: [...story.storyDrafts, draft],
        counters: {
          ...story.counters,
          story: Math.max(story.counters.story, draft.number),
        },
        projectDrafts: story.projectDrafts.map(pd =>
          pd.id === story.activeProjectDraftId
            ? { ...pd, storyDraftId: draft.id, storySyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "script": {
      const draft = emptyScriptDraft(
        genId("scd"),
        nextDraftNumber(story.scriptDrafts),
        now,
      );
      return {
        ...story,
        scriptDrafts: [...story.scriptDrafts, draft],
        counters: {
          ...story.counters,
          script: Math.max(story.counters.script, draft.number),
        },
        projectDrafts: story.projectDrafts.map(pd =>
          pd.id === story.activeProjectDraftId
            ? { ...pd, scriptDraftId: draft.id, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "episodes": {
      // TV-only. Forks a new empty Episodes layer draft. No-ops
      // gracefully for non-TV projects that have no episodesDrafts
      // array — returns the story unchanged.
      const existing = story.episodesDrafts ?? [];
      if (!story.episodesDrafts) return story;
      const draft = emptyEpisodesDraft(
        genId("epd"),
        nextDraftNumber(existing),
        now,
      );
      return {
        ...story,
        episodesDrafts: [...existing, draft],
        counters: {
          ...story.counters,
          episodes: Math.max(story.counters.episodes ?? 0, draft.number),
        },
        projectDrafts: story.projectDrafts.map(pd =>
          pd.id === story.activeProjectDraftId
            ? { ...pd, episodesDraftId: draft.id, episodesSyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "arcs": {
      const existing = story.arcsDrafts ?? [];
      const draft = emptyArcsLayerDraft(
        genId("ard"),
        nextDraftNumber(existing),
        now,
      );
      return {
        ...story,
        arcsDrafts: [...existing, draft],
        counters: {
          ...story.counters,
          arcs: Math.max(story.counters.arcs ?? 0, draft.number),
        },
        projectDrafts: story.projectDrafts.map(pd =>
          pd.id === story.activeProjectDraftId
            ? { ...pd, arcsDraftId: draft.id, arcsSyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
  }
}

export function createNewLayerDraft(story: Story, layer: LayerKey): Story {
  switch (layer) {
    case "concept":    return createNewConceptDraft(story);
    case "characters": return createNewCharactersDraft(story);
    case "story":      return createNewStoryLayerDraft(story);
    case "script":     return createNewScriptDraft(story);
    case "episodes":   return createNewEpisodesDraft(story);
    case "arcs":       return createNewArcsLayerDraft(story);
  }
}

/** TV-only — duplicate the active Arcs layer draft. Mirrors
 *  createNewEpisodesDraft. Each arc inside the draft keeps the same
 *  id-shape (we generate fresh IDs) but copies title/type/color/
 *  scores so the new draft starts as an editable snapshot of the
 *  current one. */
export function createNewArcsLayerDraft(story: Story): Story {
  const active = getActiveArcsDraft(story);
  if (!active) return story;
  const now = new Date().toISOString();
  const existing = story.arcsDrafts ?? [];
  const newDraft: ArcsLayerDraft = {
    id: genId("ard"),
    number: nextDraftNumber(existing),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    arcs: active.arcs.map(a => ({
      ...a,
      id: `arc_${Math.random().toString(36).slice(2, 10)}`,
      scores: [...a.scores],
    })),
  };
  return {
    ...story,
    arcsDrafts: [...existing, newDraft],
    counters: {
      ...story.counters,
      arcs: Math.max(story.counters.arcs ?? 0, newDraft.number),
    },
    projectDrafts: story.projectDrafts.map(pd =>
      pd.id === story.activeProjectDraftId
        ? { ...pd, arcsDraftId: newDraft.id, arcsSyncedAt: now, updatedAt: now }
        : pd
    ),
    updatedAt: now,
  };
}

/** TV-only — duplicate the active Episodes layer draft. Mirrors
 *  createNewStoryLayerDraft: deep-clones via spread (Episode arrays
 *  are shallow-copied), assigns a fresh id, bumps the layer number,
 *  and points the active project draft at the new draft. Returns
 *  story unchanged when there's no episodes layer (feature project
 *  or legacy unmigrated TV row). */
export function createNewEpisodesDraft(story: Story): Story {
  if (!story.episodesDrafts || story.episodesDrafts.length === 0) return story;
  const now = new Date().toISOString();
  const active = getActiveEpisodesDraft(story);
  if (!active) return story;
  const nextNumber = nextDraftNumber(story.episodesDrafts);
  const newDraft: EpisodesLayerDraft = {
    ...active,
    id: genId("epd"),
    number: nextNumber,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    // Deep-copy episodes + their beats so future edits don't share
    // references with the previous draft.
    episodes: active.episodes.map(e => ({
      ...e,
      beats: e.beats.map(b => ({ ...b })),
    })),
  };
  return {
    ...story,
    episodesDrafts: [...story.episodesDrafts, newDraft],
    counters: { ...story.counters, episodes: nextNumber },
    projectDrafts: story.projectDrafts.map(pd =>
      pd.id === story.activeProjectDraftId
        ? { ...pd, episodesDraftId: newDraft.id, episodesSyncedAt: now, updatedAt: now }
        : pd
    ),
    updatedAt: now,
  };
}

// ── Copy partner's layer draft to mine ──
//
// Phase 2 collaboration: the user taps a partner's draft in the
// partner-side dropdown and hits "Copy to my side." This clones that
// draft's content into the current user's own pool under a fresh id,
// bumps the draft number, and points the active project draft's
// corresponding slot at it. Semantically equivalent to createNewLayerDraft
// (duplicate the active one forward) except the source is the partner's
// draft rather than the user's own active draft.
//
// For Concept, `story.title` / `story.projectType` on the user's side
// are left alone — those are project-identity fields set at creation;
// the partner's logline / settings / concept are what gets pulled in.

export function copyPartnerLayerDraft(
  myStory: Story,
  partnerDraft: ConceptLayerDraft | CharactersLayerDraft | StoryLayerDraft | ScriptLayerDraft | EpisodesLayerDraft | ArcsLayerDraft,
  layer: LayerKey,
): Story {
  const now = new Date().toISOString();
  switch (layer) {
    case "concept": {
      const src = partnerDraft as ConceptLayerDraft;
      const draft: ConceptLayerDraft = {
        id: genId("cd"),
        number: nextDraftNumber(myStory.conceptDrafts),
        createdAt: now,
        updatedAt: now,
        savedAt: now,
        logline: src.logline,
        settings: src.settings,
        concept: src.concept,
      };
      return {
        ...myStory,
        conceptDrafts: [...myStory.conceptDrafts, draft],
        counters: { ...myStory.counters, concept: Math.max(myStory.counters.concept, draft.number) },
        projectDrafts: myStory.projectDrafts.map(pd =>
          pd.id === myStory.activeProjectDraftId
            ? { ...pd, conceptDraftId: draft.id, conceptSyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "characters": {
      const src = partnerDraft as CharactersLayerDraft;
      const draft: CharactersLayerDraft = {
        id: genId("chd"),
        number: nextDraftNumber(myStory.charactersDrafts),
        createdAt: now,
        updatedAt: now,
        savedAt: now,
        characters: src.characters.map(c => ({ ...c })),
      };
      return {
        ...myStory,
        charactersDrafts: [...myStory.charactersDrafts, draft],
        counters: { ...myStory.counters, characters: Math.max(myStory.counters.characters, draft.number) },
        projectDrafts: myStory.projectDrafts.map(pd =>
          pd.id === myStory.activeProjectDraftId
            ? { ...pd, charactersDraftId: draft.id, charactersSyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "story": {
      const src = partnerDraft as StoryLayerDraft;
      const draft: StoryLayerDraft = {
        id: genId("sd"),
        number: nextDraftNumber(myStory.storyDrafts),
        createdAt: now,
        updatedAt: now,
        savedAt: now,
        beats: src.beats.map(b => ({ ...b })),
        episodes: src.episodes ? src.episodes.map(e => ({ ...e })) : undefined,
        ingredients: [...src.ingredients],
        snippets: [...src.snippets],
        direction: src.direction,
      };
      return {
        ...myStory,
        storyDrafts: [...myStory.storyDrafts, draft],
        counters: { ...myStory.counters, story: Math.max(myStory.counters.story, draft.number) },
        projectDrafts: myStory.projectDrafts.map(pd =>
          pd.id === myStory.activeProjectDraftId
            ? { ...pd, storyDraftId: draft.id, storySyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "script": {
      const src = partnerDraft as ScriptLayerDraft;
      const draft: ScriptLayerDraft = {
        id: genId("scd"),
        number: nextDraftNumber(myStory.scriptDrafts),
        createdAt: now,
        updatedAt: now,
        savedAt: now,
        script: {
          ...src.script,
          scenes: src.script.scenes.map(s => ({ ...s })),
        },
      };
      return {
        ...myStory,
        scriptDrafts: [...myStory.scriptDrafts, draft],
        counters: { ...myStory.counters, script: Math.max(myStory.counters.script, draft.number) },
        projectDrafts: myStory.projectDrafts.map(pd =>
          pd.id === myStory.activeProjectDraftId
            ? { ...pd, scriptDraftId: draft.id, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "episodes": {
      // TV-only. Copies the partner's episodes draft into mine as a
      // new draft (matches the per-layer copy semantics of the other
      // cases). Deep-clones episodes so future edits don't share
      // references with the partner's data.
      const src = partnerDraft as EpisodesLayerDraft;
      const existing = myStory.episodesDrafts ?? [];
      const draft: EpisodesLayerDraft = {
        id: genId("epd"),
        number: nextDraftNumber(existing),
        createdAt: now,
        updatedAt: now,
        savedAt: now,
        episodes: src.episodes.map(e => ({
          ...e,
          beats: e.beats.map(b => ({ ...b })),
        })),
      };
      return {
        ...myStory,
        episodesDrafts: [...existing, draft],
        counters: {
          ...myStory.counters,
          episodes: Math.max(myStory.counters.episodes ?? 0, draft.number),
        },
        projectDrafts: myStory.projectDrafts.map(pd =>
          pd.id === myStory.activeProjectDraftId
            ? { ...pd, episodesDraftId: draft.id, episodesSyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
    case "arcs": {
      // TV-only. Copies the partner's arcs draft into mine as a new
      // draft, deep-cloning the score arrays so future edits don't
      // share references.
      const src = partnerDraft as ArcsLayerDraft;
      const existing = myStory.arcsDrafts ?? [];
      const draft: ArcsLayerDraft = {
        id: genId("ard"),
        number: nextDraftNumber(existing),
        createdAt: now,
        updatedAt: now,
        savedAt: now,
        arcs: src.arcs.map(a => ({
          ...a,
          id: `arc_${Math.random().toString(36).slice(2, 10)}`,
          scores: [...a.scores],
        })),
      };
      return {
        ...myStory,
        arcsDrafts: [...existing, draft],
        counters: {
          ...myStory.counters,
          arcs: Math.max(myStory.counters.arcs ?? 0, draft.number),
        },
        projectDrafts: myStory.projectDrafts.map(pd =>
          pd.id === myStory.activeProjectDraftId
            ? { ...pd, arcsDraftId: draft.id, arcsSyncedAt: now, updatedAt: now }
            : pd
        ),
        updatedAt: now,
      };
    }
  }
}

// ── Per-item copy from a partner's preview ──
// Used by the inline "copy this" affordances inside partner-preview mode
// (characters tab + concept tab). Unlike copyPartnerLayerDraft, these do
// NOT create a new draft — they merge a single item into my currently
// active draft, overwriting if a matching item already exists.
//
// Matching rule for characters: prefer exact id match (same partner
// character already copied once before), then fall back to case-
// insensitive name match (prevents duplicate cast rows when the id
// differs but the character is obviously the same person). If no
// match, append a fresh row with a new id local to my draft so my
// beats/scenes that reference the partner's id don't accidentally
// get linked.

export function upsertCharacterInActiveDraft(
  story: Story,
  source: Character,
): Story {
  const d = getActiveCharactersDraft(story);
  const srcName = source.name.trim().toLowerCase();
  const byId = d.characters.findIndex(c => c.id === source.id);
  const byName = srcName.length > 0
    ? d.characters.findIndex(c => c.name.trim().toLowerCase() === srcName)
    : -1;
  const idx = byId >= 0 ? byId : byName;
  let next: Character[];
  if (idx >= 0) {
    // Overwrite — keep my local id so references elsewhere still resolve.
    const mine = d.characters[idx];
    next = d.characters.map((c, i) =>
      i === idx ? { ...source, id: mine.id } : c,
    );
  } else {
    next = [
      ...d.characters,
      { ...source, id: genId("char") },
    ];
  }
  return updateCharactersDraft(story, { characters: next });
}

// Fields available for per-item copy on the Concept tab. Unlike the
// automated sync flow in syncLayer.ts (which treats title / projectType
// / genres as sovereign), this is a manual user action — if the user
// explicitly clicks "copy title from partner", we do honor it.
export type ConceptCopyField =
  | "title"
  | "projectType"
  | "logline"
  | "genres"
  | "summary"
  | "tone"
  | "themes"
  | "endingTypes"
  | "references"
  | "writerStyles";

export function copyConceptFieldFromPartner(
  story: Story,
  field: ConceptCopyField,
  source: { title: string; projectType: ProjectType; draft: ConceptLayerDraft },
): Story {
  const me = getActiveConceptDraft(story);
  const s = source.draft;
  switch (field) {
    case "title":
      return updateConceptDraft({ ...story, title: source.title }, {});
    case "projectType":
      return updateConceptDraft({ ...story, projectType: source.projectType }, {});
    case "logline":
      return updateConceptDraft(story, { logline: s.logline });
    case "summary":
      return updateConceptDraft(story, {
        concept: { ...me.concept, summary: s.concept.summary },
      });
    case "tone":
      return updateConceptDraft(story, {
        concept: { ...me.concept, tone: s.concept.tone },
      });
    case "themes":
      return updateConceptDraft(story, {
        concept: { ...me.concept, themes: [...s.concept.themes] },
      });
    case "genres":
      return updateConceptDraft(story, {
        settings: { ...me.settings, genres: [...s.settings.genres] },
      });
    case "endingTypes":
      return updateConceptDraft(story, {
        settings: { ...me.settings, endingTypes: [...s.settings.endingTypes] },
      });
    case "references":
      return updateConceptDraft(story, {
        settings: {
          ...me.settings,
          references: s.settings.references.map(r => ({
            ...r,
            aspects: [...r.aspects],
          })),
        },
      });
    case "writerStyles":
      return updateConceptDraft(story, {
        settings: { ...me.settings, writerStyles: [...s.settings.writerStyles] },
      });
  }
}

// ── Save layer draft ──
// Mark the active layer draft as "saved" — advances savedAt to updatedAt.
// No new draft is created; this just clears the dirty state.

export function saveLayerDraft(story: Story, layer: LayerKey): Story {
  const pd = getActiveProjectDraft(story);
  const now = new Date().toISOString();
  const refKey: "conceptDraftId" | "charactersDraftId" | "storyDraftId" | "scriptDraftId" | "episodesDraftId" | "arcsDraftId" =
    layer === "concept"    ? "conceptDraftId" :
    layer === "characters" ? "charactersDraftId" :
    layer === "story"      ? "storyDraftId" :
    layer === "episodes"   ? "episodesDraftId" :
    layer === "arcs"       ? "arcsDraftId" :
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
    case "episodes": {
      // No-op for feature projects (no episodesDrafts array). For TV
      // projects, bump the active episodes draft's savedAt so the dirty
      // dot clears and the autosave/save semantics match the other layers.
      if (!story.episodesDrafts) return story;
      return { ...story, episodesDrafts: mapDraft(story.episodesDrafts), updatedAt: now };
    }
    case "arcs": {
      if (!story.arcsDrafts) return story;
      return { ...story, arcsDrafts: mapDraft(story.arcsDrafts), updatedAt: now };
    }
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
  // Episodes + Arcs layers suppress the dirty-dot in Phase 1 — same
  // reasoning as episodes: adding/editing on the Archs tab bumps
  // updatedAt continuously, so the dot would read as constant
  // noise. Revisit when these layers get explicit save semantics.
  if (layer === "episodes" || layer === "arcs") return false;
  const draft =
    layer === "concept"    ? getActiveConceptDraft(story) :
    layer === "characters" ? getActiveCharactersDraft(story) :
    layer === "story"      ? getActiveStoryLayerDraft(story) :
                             getActiveScriptDraft(story);
  return isLayerDraftDirty(draft ?? undefined);
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
  const nextNumber = nextDraftNumber(story.projectDrafts);
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

/**
 * Duplicate the currently active project draft into a fresh, independent
 * copy. Unlike `createNewProjectDraft` — which creates a new project-draft
 * row that still shares layer pointers with the original — this also
 * clones each of the four underlying layer drafts so edits to the new
 * project draft don't leak back into the source.
 *
 * Implementation: compose the existing primitives. `createNewProjectDraft`
 * first creates the new project draft and makes it active; then each
 * `createNewLayerDraft(next, <layer>)` clones the active layer draft and
 * repoints the now-active (new) project draft at the clone. Result: a
 * new PD whose four layer pointers are all freshly-minted.
 */
export function duplicateActiveProjectDraft(story: Story): Story {
  let next = createNewProjectDraft(story);
  next = createNewLayerDraft(next, "concept");
  next = createNewLayerDraft(next, "characters");
  next = createNewLayerDraft(next, "story");
  next = createNewLayerDraft(next, "script");
  return next;
}

/**
 * Create a brand-new, empty project draft and make it active.
 *
 * Unlike `createNewProjectDraft` (which inherits the current layer-draft
 * pointers) or `duplicateActiveProjectDraft` (which deep-clones them),
 * this creates a fresh empty draft in every layer. The only content
 * carried forward is the user's original project-level choices:
 *   - title (lives on Story itself, not a layer draft)
 *   - projectType / format (lives on Story itself)
 *   - genres (lives inside Concept.settings — preserved explicitly)
 *
 * Everything else — logline, summary, tone, themes, framework, sub-genres,
 * references, writer styles, vibe, numeric sliders, ending types,
 * characters, beats/episodes/ingredients/snippets, scenes — starts blank.
 */
export function createEmptyProjectDraft(story: Story): Story {
  const now = new Date().toISOString();
  const prevGenres = getActiveConceptDraft(story).settings.genres;

  const conceptDraft = emptyConceptDraft(
    genId("cd"),
    nextDraftNumber(story.conceptDrafts),
    now,
  );
  // Carry genres forward — the user chose them at project creation and
  // they're project-identity level, not per-draft-exploration.
  conceptDraft.settings = { ...conceptDraft.settings, genres: [...prevGenres] };

  const charactersDraft = emptyCharactersDraft(
    genId("chd"),
    nextDraftNumber(story.charactersDrafts),
    now,
  );
  const storyDraft = emptyStoryLayerDraft(
    genId("sd"),
    nextDraftNumber(story.storyDrafts),
    now,
  );
  const scriptDraft = emptyScriptDraft(
    genId("scd"),
    nextDraftNumber(story.scriptDrafts),
    now,
  );

  const newPD: ProjectDraft = {
    id: genId("pd"),
    number: nextDraftNumber(story.projectDrafts),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    conceptDraftId: conceptDraft.id,
    charactersDraftId: charactersDraft.id,
    storyDraftId: storyDraft.id,
    scriptDraftId: scriptDraft.id,
    savedConceptDraftId: conceptDraft.id,
    savedCharactersDraftId: charactersDraft.id,
    savedStoryDraftId: storyDraft.id,
    savedScriptDraftId: scriptDraft.id,
    conceptSyncedAt: now,
    charactersSyncedAt: now,
    storySyncedAt: now,
  };

  return {
    ...story,
    conceptDrafts: [...story.conceptDrafts, conceptDraft],
    charactersDrafts: [...story.charactersDrafts, charactersDraft],
    storyDrafts: [...story.storyDrafts, storyDraft],
    scriptDrafts: [...story.scriptDrafts, scriptDraft],
    projectDrafts: [...story.projectDrafts, newPD],
    activeProjectDraftId: newPD.id,
    counters: {
      concept: Math.max(story.counters.concept, conceptDraft.number),
      characters: Math.max(story.counters.characters, charactersDraft.number),
      story: Math.max(story.counters.story, storyDraft.number),
      script: Math.max(story.counters.script, scriptDraft.number),
      project: Math.max(story.counters.project, newPD.number),
    },
    updatedAt: now,
  };
}

/**
 * Clone one of the partner's project drafts onto my side as a new
 * project draft, deep-cloning each of its four layer drafts into my
 * own pool. Makes the new project draft active so the user lands on
 * a complete snapshot of the partner's combination immediately.
 *
 * Called from the project-drafts sheet when the current viewer taps
 * a row under "Partner's drafts" — same interaction as
 * `copyPartnerLayerDraft` but for the full 4-layer bundle rather
 * than a single layer.
 */
export function copyPartnerProjectDraft(
  myStory: Story,
  partnerStory: Story,
  partnerDraft: ProjectDraft,
): Story {
  const now = new Date().toISOString();

  const srcConcept = partnerStory.conceptDrafts.find(
    d => d.id === partnerDraft.conceptDraftId,
  );
  const srcCharacters = partnerStory.charactersDrafts.find(
    d => d.id === partnerDraft.charactersDraftId,
  );
  const srcStory = partnerStory.storyDrafts.find(
    d => d.id === partnerDraft.storyDraftId,
  );
  const srcScript = partnerStory.scriptDrafts.find(
    d => d.id === partnerDraft.scriptDraftId,
  );
  // If any referenced layer draft can't be found in the partner's
  // pool we bail silently — the partner row is effectively malformed
  // and copying half a bundle is worse than copying none.
  if (!srcConcept || !srcCharacters || !srcStory || !srcScript) {
    return myStory;
  }

  const newConcept: ConceptLayerDraft = {
    id: genId("cd"),
    number: nextDraftNumber(myStory.conceptDrafts),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    logline: srcConcept.logline,
    settings: srcConcept.settings,
    concept: srcConcept.concept,
  };
  const newCharacters: CharactersLayerDraft = {
    id: genId("chd"),
    number: nextDraftNumber(myStory.charactersDrafts),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    characters: srcCharacters.characters.map(c => ({ ...c })),
  };
  const newStoryDraft: StoryLayerDraft = {
    id: genId("sd"),
    number: nextDraftNumber(myStory.storyDrafts),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    beats: srcStory.beats.map(b => ({ ...b })),
    episodes: srcStory.episodes ? srcStory.episodes.map(e => ({ ...e })) : undefined,
    ingredients: [...srcStory.ingredients],
    snippets: [...srcStory.snippets],
    direction: srcStory.direction,
  };
  const newScript: ScriptLayerDraft = {
    id: genId("scd"),
    number: nextDraftNumber(myStory.scriptDrafts),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    script: {
      ...srcScript.script,
      scenes: srcScript.script.scenes.map(s => ({ ...s })),
    },
  };
  const newPD: ProjectDraft = {
    id: genId("pd"),
    number: nextDraftNumber(myStory.projectDrafts),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    conceptDraftId: newConcept.id,
    charactersDraftId: newCharacters.id,
    storyDraftId: newStoryDraft.id,
    scriptDraftId: newScript.id,
    savedConceptDraftId: newConcept.id,
    savedCharactersDraftId: newCharacters.id,
    savedStoryDraftId: newStoryDraft.id,
    savedScriptDraftId: newScript.id,
    conceptSyncedAt: now,
    charactersSyncedAt: now,
    storySyncedAt: now,
  };

  return {
    ...myStory,
    conceptDrafts: [...myStory.conceptDrafts, newConcept],
    charactersDrafts: [...myStory.charactersDrafts, newCharacters],
    storyDrafts: [...myStory.storyDrafts, newStoryDraft],
    scriptDrafts: [...myStory.scriptDrafts, newScript],
    projectDrafts: [...myStory.projectDrafts, newPD],
    activeProjectDraftId: newPD.id,
    counters: {
      concept: Math.max(myStory.counters.concept, newConcept.number),
      characters: Math.max(myStory.counters.characters, newCharacters.number),
      story: Math.max(myStory.counters.story, newStoryDraft.number),
      script: Math.max(myStory.counters.script, newScript.number),
      project: Math.max(myStory.counters.project, newPD.number),
    },
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
      // For TV the "story" layer is per-episode; data lives on
      // Story.episodesDrafts[*].episodes[*].beats now. Treat the
      // layer as empty when no beat inside any episode has been
      // started. Feature projects keep the old single-array check.
      if (story.projectType === "tv-show") {
        const epd = getActiveEpisodesDraft(story);
        return !epd || epd.episodes.every(ep => ep.beats.length === 0);
      }
      const s = getActiveStoryLayerDraft(story);
      if (!s) return true;
      return s.beats.length === 0;
    }
    case "script": {
      // Written scene prose is stored on beats (beat.sceneContent),
      // not only on script.scenes. Treat the Script layer as non-empty
      // if either place has content. Any beat with non-empty
      // sceneContent counts — don't gate on status, since a prior sync
      // or edit may leave content in place while toggling status.
      const sc = getActiveScriptDraft(story);
      const hasScenes = !!sc && sc.script.scenes.length > 0;
      if (hasScenes) return false;
      const allBeats = story.projectType === "tv-show"
        ? (getActiveEpisodesDraft(story)?.episodes ?? []).flatMap(ep => ep.beats)
        : (getActiveStoryLayerDraft(story)?.beats ?? []);
      const hasSceneProse = allBeats.some(
        b => (b.sceneContent ?? "").trim() !== ""
      );
      return !hasSceneProse;
    }
    case "episodes": {
      // TV-only layer. Empty if there are zero episodes in the
      // active draft. Feature projects return true (no episodes
      // concept) — but callers should generally only hit this on TV.
      const epd = getActiveEpisodesDraft(story);
      return !epd || epd.episodes.length === 0;
    }
    case "arcs": {
      // TV-only. Empty when there are no arcs in the active arcs
      // draft (project still has its seeded empty draft).
      const ard = getActiveArcsDraft(story);
      return !ard || ard.arcs.length === 0;
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
  | { kind: "script";     scenes: Scene[] }
  /** TV-only — used when a sync targets the Episodes layer
   *  directly (e.g. generate-episode-from-concept). */
  | { kind: "episodes";   episodes: Episode[] }
  /** TV-only — placeholder for future sync flows that target the
   *  Arcs layer. Phase 1 leaves this as a passthrough; the Arcs
   *  tab is hand-edited only. */
  | { kind: "arcs";       arcs: Arc[] };

export function createAndActivateLayerDraftWith(story: Story, content: LayerContent): Story {
  // Step 1: create a new draft (branches from active, becomes active).
  const branched =
    content.kind === "concept"    ? createNewConceptDraft(story) :
    content.kind === "characters" ? createNewCharactersDraft(story) :
    content.kind === "story"      ? createNewStoryLayerDraft(story) :
    content.kind === "episodes"   ? createNewEpisodesDraft(story) :
    content.kind === "arcs"       ? createNewArcsLayerDraft(story) :
                                    createNewScriptDraft(story);
  // Step 2: apply the content to the now-active new draft.
  switch (content.kind) {
    case "concept":    return replaceActiveConceptContent(branched, content.patch);
    case "characters": return replaceActiveCharactersContent(branched, content.characters);
    case "story":      return replaceActiveStoryContent(branched, content.beats, content.episodes);
    case "script":     return replaceActiveScriptContent(branched, content.scenes);
    case "episodes":   return updateEpisodesDraft(branched, { episodes: content.episodes });
    case "arcs":       return updateArcsDraft(branched, { arcs: content.arcs });
  }
}

/**
 * High-level "apply a sync result" helper: given a target layer and a
 * derived content payload, either overwrite the active draft (if empty)
 * or create a new draft and activate it (if non-empty).
 *
 * `emptyCheckStory` is an optional second story used ONLY for the
 * empty-vs-nonempty decision. Default: `story`. Pass the pre-batch
 * snapshot when running `syncLayers` so that, e.g., a prior Story sync
 * doesn't trick the Script target into thinking Script is empty — the
 * user's original written scene prose still counts as content.
 */
export function applySyncResult(
  story: Story,
  content: LayerContent,
  emptyCheckStory: Story = story,
): Story {
  const layer: LayerKey = content.kind;
  if (isLayerDraftEmpty(emptyCheckStory, layer)) {
    switch (content.kind) {
      case "concept":    return replaceActiveConceptContent(story, content.patch);
      case "characters": return replaceActiveCharactersContent(story, content.characters);
      case "story":      return replaceActiveStoryContent(story, content.beats, content.episodes);
      case "script":     return replaceActiveScriptContent(story, content.scenes);
      case "episodes":   return updateEpisodesDraft(story, { episodes: content.episodes });
      case "arcs":       return updateArcsDraft(story, { arcs: content.arcs });
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

/** Format a screenplay-style slugline from a Beat's `location` and
 *  `timeOfDay` free-text fields.
 *
 *  Behavior:
 *  - Returns `null` when both fields are empty/missing (callers
 *    suppress the heading row).
 *  - When `location` is set but doesn't already start with an
 *    `INT.` / `EXT.` prefix (case-insensitive, optional dot, one or
 *    more whitespace chars), prepends `"INT. "` as a sensible
 *    default. Existing prefixes pass through verbatim.
 *  - Uppercases everything for screenplay convention.
 *  - Joins location + " - " + time when both present.
 *
 *  Examples:
 *    ("Apartment", "Night")      → "INT. APARTMENT - NIGHT"
 *    ("INT. Apartment", "Night") → "INT. APARTMENT - NIGHT"
 *    ("EXT. Forest", "Day")      → "EXT. FOREST - DAY"
 *    ("Apartment", undefined)    → "INT. APARTMENT"
 *    (undefined, "Night")        → "NIGHT"
 *    (undefined, undefined)      → null
 */
export function formatSlugline(
  location: string | undefined | null,
  timeOfDay: string | undefined | null,
): string | null {
  const loc = (location ?? "").trim();
  const tod = (timeOfDay ?? "").trim();
  if (!loc && !tod) return null;
  let locPart = "";
  if (loc) {
    const hasPrefix = /^(INT|EXT)\.?\s/i.test(loc);
    locPart = hasPrefix ? loc.toUpperCase() : `INT. ${loc.toUpperCase()}`;
  }
  const todPart = tod.toUpperCase();
  if (locPart && todPart) return `${locPart} - ${todPart}`;
  return locPart || todPart;
}
