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
  | "clean_beat";

export interface ActionRequest {
  type: ActionType;
  payload: Record<string, any>;
}

// Route actions to models — Haiku for fast/mechanical, Sonnet for prose/reasoning.
export function modelForAction(type: ActionType): string {
  switch (type) {
    case "generate_scene":
    case "rewrite_beat":
      return "claude-sonnet-4-5"; // quality matters for prose
    case "generate_beats":
    case "swap_ingredient":
    case "add_twist":
    case "brainstorm":
    case "clean_beat":
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
