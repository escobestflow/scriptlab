// The screenwriting "brain". This is the product.
// Iterate on this file as a UX designer would iterate on a design system.

export const SYSTEM_BRAIN = `You are ScriptWriter, an expert screenwriting collaborator for movies, TV, and short films. You help the user structure stories using classical frameworks while adapting to their creative intent.

# Frameworks you know cold
- Save the Cat (15 beats: Opening Image, Theme Stated, Set-Up, Catalyst, Debate, Break Into Two, B Story, Fun and Games, Midpoint, Bad Guys Close In, All Is Lost, Dark Night of the Soul, Break Into Three, Finale, Final Image)
- Hero's Journey (12 stages)
- Three-Act Structure
- Dan Harmon's Story Circle (8 steps)

# Core principles
- Story is structure plus surprise. Honor the framework but break it deliberately when the vibe demands it.
- Characters want something external and need something internal. The arc is closing that gap.
- Every beat has a PURPOSE (what it does for the audience) and a SUMMARY (what happens).
- "Ingredients" are the raw material — specific objects, settings, rules, images. When an ingredient is locked, you MUST keep it. When unlocked, you may swap, reshape, or reinterpret it.
- "Snippets" are pre-written moments the user loves. Weave them in naturally when relevant; never discard them.

# How to use settings
- genre, vibe → tone of prose, kind of imagery, types of conflict
- unpredictability (1-10) → how often you subvert expected beats. 1 = by-the-book. 10 = reinvent at every turn.
- darkness (1-10) → emotional weight, willingness to go to hard places
- pace (1-10) → density of incident per beat
- endingType → shapes the resolution and back-propagates choices into earlier beats
- framework → which beat skeleton to produce

# Output rules
- When the user asks for structured output (beats, character arcs), return STRICT JSON matching the schema provided in the user message. No prose outside the JSON.
- When the user asks for prose (a scene, dialogue pass), return only the prose.
- NEVER apologize, NEVER explain your process, NEVER add meta-commentary unless asked.
- Be specific and sensory. Avoid generic screenwriting clichés.
- Respect locked ingredients absolutely.
`;

// Action types = different "tools" the UI exposes to the user.
// Each one routes to an appropriate model and assembles context differently.
export type ActionType =
  | "generate_beats"
  | "swap_ingredient"
  | "add_twist"
  | "rewrite_beat"
  | "generate_scene"
  | "brainstorm"
  | "clean_beat"
  | "generate_beat"
  | "clean_moment"
  // Concept-tab per-field generators (Haiku, JSON-out)
  | "generate_concept_title"
  | "generate_concept_logline"
  | "generate_concept_summary"
  | "generate_concept_tone"
  | "generate_concept_themes"
  | "generate_concept_ending"
  // Top-level concept expansion. Used by Easy mode at project creation:
  // takes a freshly-created Story whose only seeded fields are title +
  // genres + projectType, and fills out logline / summary / tone /
  // themes / endingTypes in a single Sonnet call. Protected fields
  // (title, projectType, genres) are stripped from the response client-
  // side, same defense-in-depth as the sync_*_to_concept actions.
  | "generate_full_concept"
  // Character-tab per-field generators (Haiku, JSON-out)
  | "generate_character_name"
  | "generate_character_archetype"
  | "generate_character_backstory"
  | "generate_character_motivations"
  | "generate_character_flaws"
  | "generate_character_want"
  | "generate_character_need"
  | "generate_character_voice"
  | "generate_character_arc"
  | "generate_character_notes"
  // Name-based gender auto-detection. Fires from CharacterEditForm
  // on sheet-close when the user didn't pick a gender. Returns a
  // single canonical token; see CharacterGender in lib/story.ts.
  | "detect_character_gender"
  // ── Cross-layer sync (Update Other Layers) ──
  // 12 combinations: from each of the 4 layers, derive any of the other 3.
  // Each returns strict JSON matching the target layer's schema.
  | "sync_concept_to_characters"
  | "sync_concept_to_story"
  | "sync_concept_to_script"
  | "sync_characters_to_concept"
  | "sync_characters_to_story"
  | "sync_characters_to_script"
  | "sync_story_to_concept"
  | "sync_story_to_characters"
  | "sync_story_to_script"
  | "sync_script_to_concept"
  | "sync_script_to_characters"
  | "sync_script_to_story"
  // ── Script-import pipeline ──
  // Multi-step import of an uploaded .txt/.pdf screenplay. Step 1 slices
  // the raw file into word-for-word scenes; step 2 generates one beat
  // per scene with an AI-written summary. Characters + Concept use the
  // existing sync_script_to_* actions as steps 3 and 4.
  | "import_extract_scenes"
  | "import_summarize_scenes"
  // ── Read-through highlighter rewrite ──
  // Rewrites a user-highlighted passage inside a scene's prose per a
  // natural-language instruction. Returns JSON { "replacement": string }
  // that the client splices back into scene.content.
  | "rewrite_highlighted_range";

export interface ActionRequest {
  type: ActionType;
  payload: Record<string, any>;
}

// Route actions to models — Haiku for fast/mechanical, Sonnet for prose/reasoning.
export function modelForAction(type: ActionType): string {
  switch (type) {
    case "generate_scene":
    case "rewrite_beat":
    // Sync → script is long-form prose — match generate_scene routing.
    case "sync_concept_to_script":
    case "sync_characters_to_script":
    case "sync_story_to_script":
    // Easy-mode concept expansion: writing a coherent logline, summary,
    // tone, themes, and endingTypes from just title+genre is creative
    // work — Sonnet handles tonal nuance better than Haiku.
    case "generate_full_concept":
    // Import-pipeline extraction also benefits from Sonnet: scene
    // identification against a 20–40k-token source needs high recall,
    // and per-scene summarization over the full script is dense work.
    case "import_extract_scenes":
    case "import_summarize_scenes":
    // Highlighter rewrite is short but craft-heavy — picks words that
    // have to sit seamlessly inside surrounding prose. Sonnet handles
    // the tonal continuity better than Haiku.
    case "rewrite_highlighted_range":
      return "claude-sonnet-4-5"; // quality matters for prose
    case "generate_beats":
    case "swap_ingredient":
    case "add_twist":
    case "brainstorm":
    case "clean_beat":
    case "generate_beat":
    case "clean_moment":
    case "generate_concept_title":
    case "generate_concept_logline":
    case "generate_concept_summary":
    case "generate_concept_tone":
    case "generate_concept_themes":
    case "generate_concept_ending":
    case "generate_character_name":
    case "generate_character_archetype":
    case "generate_character_backstory":
    case "generate_character_motivations":
    case "generate_character_flaws":
    case "generate_character_want":
    case "generate_character_need":
    case "generate_character_voice":
    case "generate_character_arc":
    case "generate_character_notes":
    case "detect_character_gender":
    default:
      return "claude-haiku-4-5"; // fast + cheap for structure work
  }
}

// Model pricing per 1M tokens (USD). Used for live cost logging.
// Sources: Anthropic pricing page. Update if they change.
export const PRICING: Record<string, {
  input: number; output: number; cacheWrite: number; cacheRead: number;
}> = {
  "claude-haiku-4-5":  { input: 1,  output: 5,  cacheWrite: 1.25, cacheRead: 0.1  },
  "claude-sonnet-4-5": { input: 3,  output: 15, cacheWrite: 3.75, cacheRead: 0.3  },
  "claude-opus-4-5":   { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};

export function costFromUsage(model: string, usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}) {
  const p = PRICING[model] ?? PRICING["claude-haiku-4-5"];
  const input  = (usage.input_tokens ?? 0)                * p.input      / 1_000_000;
  const output = (usage.output_tokens ?? 0)               * p.output     / 1_000_000;
  const cWrite = (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite / 1_000_000;
  const cRead  = (usage.cache_read_input_tokens ?? 0)     * p.cacheRead  / 1_000_000;
  return { input, output, cWrite, cRead, total: input + output + cWrite + cRead };
}
