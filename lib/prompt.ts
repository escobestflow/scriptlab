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

# TV series types (read the project's seriesType setting and obey it absolutely)
TV projects declare what KIND of series they are. The value comes from the project bible's "Series type" block when present. Each value reshapes how episodes should be built — episode independence, arc continuity, ending posture. When seriesType is unspecified, fall back to a neutral "let the concept dictate" mode.

- **Limited Series** — ONE complete story across one season. Finale RESOLVES the central arc; no sequel hooks. Every episode escalates toward a single definitive ending. Don't seed threads the season can't pay off.
- **Anthology Series** — Each season is a self-contained unit. Future seasons will have new characters / setting / conflict — do not write toward continuity beyond this season's finale. The season arc IS the unit of story.
- **Ongoing / Serialized Series** — Multi-season, must-watch-in-order. Episodes are highly connected; threads carry across episodes and seasons. The season finale leaves seeds for next season — a clean bow on a serialized finale is a FAILURE MODE. Characters evolve cumulatively, never reset.
- **Episodic Series** — Each episode largely STANDALONE (case/problem/patient of the week, resolved within the episode). Characters return to baseline by episode end. Cross-episode arcs are light. The episode-momentum rule is RELAXED for episodic — a satisfying contained resolution + a small character note IS a valid ending; cliffhangers should be rare.
- **Hybrid Series** — Episode-of-the-week + serialized background arcs. Each episode resolves its contained A-story AND advances at least one serialized arc. The momentum rule applies to the serialized thread even when the A-story closed cleanly.

# TV-specific principle: every episode ends on momentum
- When generating ANY TV episode content — structure, beats, or screenplay scenes — the FINAL beat / final scene must create narrative momentum into the next episode. Endings do not stop the story.
- A momentum ending lands on at least one of: (a) a change in the audience's understanding, (b) an escalation of an active season arc (stakes, scope, trajectory), (c) a reveal of new information, (d) a deepened character conflict (existing tension cracks open OR new one ignites), or (e) an emotionally / dramatically charged question left unresolved.
- This rule applies to finales too — the final-finale should leave the audience with a question that lingers past the credits, not a tidy bow. EXCEPTION: a Limited Series finale, by spec, resolves the arc — there it's the only place a "complete" landing is correct.
- For Episodic series this rule is RELAXED — see the series-type block above. For all other types (Limited, Anthology, Ongoing, Hybrid) the rule fires at full strength.
- When writing the final SCENE of an episode, the closing image / line / action must carry this energy. A "fade out on a quiet moment" is only valid if the quietness itself contains the unresolved charge.

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
  | "generate_concept_tagline"
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
  // Whole-character single-add: returns ONE new character that
  // fits the current story. Mirrors `generate_beat` for scenes —
  // append-at-end UX for the populated Characters tab's white AI
  // chip. Distinct from `sync_concept_to_characters` (which
  // regenerates the entire layer) and from the per-field
  // generators below.
  | "generate_character"
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
  | "rewrite_highlighted_range"
  // ── TV episode generation ──
  // `generate_episode` is the AI-variant of "Add an Episode" on the
  // Episodes tab. Reads the project concept + characters + season arc
  // + the position (next-episode-number of total planned) and
  // returns: a proper episode title + a 1-paragraph logline + a seed
  // beat list (5–8 beats). Result patches into a new episode that
  // the client then opens directly.
  | "generate_episode"
  // ── Continuity check ──
  // Walks every episode's beats + dialogue and surfaces inconsistencies
  // (character knows something they shouldn't, dropped plot threads,
  // under-used characters). Returns a structured notes list the UI
  // renders as a panel. Sonnet-grade; on-demand only.
  | "check_continuity"
  // ── TV-only "Upload Script → build the show" pipeline ──
  // 5-step pipeline that takes an uploaded script + free-text notes and
  // populates concept → characters → arcs → all episodes → pilot script.
  // Each step builds on the prior so storyBible carries each layer's
  // output forward. Concept step is fill-only (no overwrite of filled
  // fields); the rest are full generations.
  | "tv_import_concept"
  | "tv_import_characters"
  | "tv_import_arcs"
  | "tv_import_episodes"
  | "tv_import_pilot";

export interface ActionRequest {
  type: ActionType;
  payload: Record<string, any>;
}

// Route actions to models — three tiers:
//
//   OPUS    — screenplay-writing only. The thing the writer actually
//             reads end-to-end. Dialogue voice consistency across
//             multiple characters, subtext that doesn't crack into
//             on-the-nose exposition, scene architecture that
//             compounds across beats. ~5× the cost of Sonnet per
//             token, justified because the user-facing artifact is
//             the screenplay.
//   SONNET  — structural reasoning + long-source comprehension. Arcs,
//             episode structure, season-wide continuity, concept fill
//             from a long script. ~4× the cost of Haiku, justified
//             because structure mistakes compound across a season.
//   HAIKU   — single-field generation, mechanical syncs, anything
//             where output is short and the input is the project
//             bible. Cheap by default.
export function modelForAction(type: ActionType): string {
  switch (type) {
    // ── OPUS tier — screenplay prose only ────────────────────────────
    // The user reads this end-to-end. Dialogue must sound like real
    // people who don't sound like each other; scene transitions need
    // to compound; subtext needs to land. Opus handles this in a way
    // Sonnet noticeably can't — especially across multi-page scenes
    // with multiple characters.
    case "generate_scene":
    // Sync → script writes screenplay prose from upstream layers.
    // Same craft as generate_scene; same tier.
    case "sync_concept_to_script":
    case "sync_characters_to_script":
    case "sync_story_to_script":
    // The highlighter rewrite is small in scope (one passage) but
    // ENORMOUS in stakes — the user picked exactly this line and is
    // judging the result against their own taste. Opus.
    case "rewrite_highlighted_range":
    // The pilot screenplay step of the TV-import pipeline is the
    // payoff the user actually reads. Everything else in the pipeline
    // is scaffolding; this one IS the thing.
    case "tv_import_pilot":
      return "claude-opus-4-5";

    // ── SONNET tier — structural + long-source comprehension ─────────
    case "rewrite_beat":
    // Easy-mode concept expansion: writing a coherent logline, summary,
    // tone, themes, and endingTypes from just title+genre is creative
    // work — Sonnet handles tonal nuance better than Haiku.
    case "generate_full_concept":
    // Import-pipeline extraction also benefits from Sonnet: scene
    // identification against a 20–40k-token source needs high recall,
    // and per-scene summarization over the full script is dense work.
    case "import_extract_scenes":
    case "import_summarize_scenes":
    // generate_episode produces title + logline + 5–8 beats grounded in
    // the season arc and prior episodes — structural reasoning + tone
    // continuity work, Sonnet-grade.
    case "generate_episode":
    // check_continuity reads the entire season and surfaces issues.
    // Long-context + nuanced reasoning ⇒ Sonnet.
    case "check_continuity":
    // TV-only "Upload Script" pipeline — steps 1-4 ingest a long
    // source document (script + notes) and write STRUCTURED output
    // grounded in it (concept fields, character roster, season arcs,
    // episode skeletons). The pilot step (5) is on Opus above. These
    // four are structural — Sonnet handles them well at a fraction
    // of Opus cost.
    case "tv_import_concept":
    case "tv_import_characters":
    case "tv_import_arcs":
    case "tv_import_episodes":
      return "claude-sonnet-4-5"; // structural reasoning
    case "generate_beats":
    case "swap_ingredient":
    case "add_twist":
    case "brainstorm":
    case "clean_beat":
    case "generate_beat":
    case "generate_character":
    case "clean_moment":
    case "generate_concept_title":
    case "generate_concept_logline":
    case "generate_concept_summary":
    case "generate_concept_tagline":
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
