// The context builder is the heart of the cost model.
// Given a story + an action, it assembles the minimum viable prompt
// and marks the stable prefix as CACHEABLE so Anthropic bills it at 10%.
//
// Cache strategy:
//   Block 1 (cached): SYSTEM_BRAIN — never changes
//   Block 2 (cached): Story bible snapshot — changes rarely (settings, characters)
//   Block 3 (fresh):  The current ask — changes every request
//
// This means iterative edits inside a session reuse ~90% of input tokens
// at 10% price. Without this pattern, heavy usage is uneconomical.

import { Story } from "./story";
import { ActionRequest, SYSTEM_BRAIN } from "./prompt";

export interface BuiltPrompt {
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  userMessage: string;
}

export function buildPrompt(story: Story, action: ActionRequest): BuiltPrompt {
  // Block 2: the story bible — stable within a session, worth caching.
  const bible = storyBible(story);

  // Block 3: the ask — fresh every request.
  const ask = buildAsk(story, action);

  return {
    system: [
      // Block 1 — cached forever across all users & sessions
      {
        type: "text",
        text: SYSTEM_BRAIN,
        cache_control: { type: "ephemeral" },
      },
      // Block 2 — cached per session. Second cache breakpoint.
      {
        type: "text",
        text: bible,
        cache_control: { type: "ephemeral" },
      },
    ],
    userMessage: ask,
  };
}

function storyBible(story: Story): string {
  const { settings, characters, ingredients, snippets, beats } = story;
  return `# CURRENT PROJECT BIBLE

## Title
${story.title || "(untitled)"}

## Logline
${story.logline || "(none yet)"}

## Settings
- Framework: ${settings.framework}
- Genre: ${settings.genre}
- Vibe: ${settings.vibe}
- Unpredictability: ${settings.unpredictability}/10
- Darkness: ${settings.darkness}/10
- Pace: ${settings.pace}/10
- Ending type: ${settings.endingType}

## Characters
${characters.map(c => `- ${c.name} (${c.role}) — wants: ${c.want}; needs: ${c.need}${c.notes ? `; ${c.notes}` : ""}`).join("\n") || "(none)"}

## Ingredients
${ingredients.map(i => `- [${i.locked ? "LOCKED" : "free"}] ${i.label}: ${i.description}`).join("\n") || "(none)"}

## Snippets (pre-written moments the user loves)
${snippets.map(s => `### ${s.title} [${s.tags.join(", ")}]\n${s.content}`).join("\n\n") || "(none)"}

## Current beat sheet
${beats.length
  ? beats.map((b, i) => `${i + 1}. ${b.name}: ${b.summary}`).join("\n")
  : "(no beats yet)"}
`;
}

function buildAsk(story: Story, action: ActionRequest): string {
  switch (action.type) {
    case "generate_beats":
      return `Generate a complete beat sheet for this project using the ${story.settings.framework} framework.

Return STRICT JSON in this exact schema:
{ "beats": [ { "name": string, "summary": string, "purpose": string } ] }

Rules:
- Use every locked ingredient meaningfully.
- Weave in at least one snippet where it fits naturally (reference by title in the purpose field).
- Match the darkness/pace/unpredictability levels.
- Respect the ending type: "${story.settings.endingType}".`;

    case "swap_ingredient": {
      const id = action.payload.ingredientId;
      const ing = story.ingredients.find(i => i.id === id);
      return `Suggest 3 replacement options for the ingredient labeled "${ing?.label}" (currently: "${ing?.description}"). Keep the same structural role but push the unpredictability level (${story.settings.unpredictability}/10).

Return STRICT JSON: { "options": [ { "label": string, "description": string, "why": string } ] }`;
    }

    case "add_twist":
      return `Propose a twist to inject into the current beat sheet. Target unpredictability: ${story.settings.unpredictability}/10.

Return STRICT JSON: { "twist": { "insertAfterBeat": number, "description": string, "ripple": string } }
- "ripple" explains which later beats need to shift and how.`;

    case "rewrite_beat": {
      const idx = action.payload.beatIndex;
      const instruction = action.payload.instruction ?? "make it sharper";
      const beat = story.beats[idx];
      return `Rewrite beat #${idx + 1} ("${beat?.name}"). Current summary: "${beat?.summary}"

Instruction: ${instruction}

Return STRICT JSON: { "beat": { "name": string, "summary": string, "purpose": string } }`;
    }

    case "generate_scene": {
      const idx = action.payload.beatIndex;
      const beat = story.beats[idx];
      return `Write the full scene for beat #${idx + 1} ("${beat?.name}" — ${beat?.summary}).
Match the vibe "${story.settings.vibe}" and genre "${story.settings.genre}".
Return prose in screenplay-adjacent format. No JSON, no preamble.`;
    }

    case "brainstorm":
      return `The user wants to brainstorm: "${action.payload.prompt}"
Respond with 5 concrete, specific ideas grounded in this project's bible. Return STRICT JSON: { "ideas": [ { "title": string, "description": string } ] }`;

    default:
      return `Unknown action.`;
  }
}
