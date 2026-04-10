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
- Genres: ${(settings as any).genres?.join(", ") || (settings as any).genre || "none"}
- Vibe: ${settings.vibe}
- Unpredictability: ${settings.unpredictability}/10
- Darkness: ${settings.darkness}/10
- Pace: ${settings.pace}/10
- Ending types: ${(settings as any).endingTypes?.join(", ") || (settings as any).endingType || "none"}

## Characters
${characters.map(c => `- ${c.name} (${c.role}) — wants: ${c.want}; needs: ${c.need}${c.notes ? `; ${c.notes}` : ""}`).join("\n") || "(none)"}

## Ingredients
${ingredients.map(i => `- [${i.locked ? "LOCKED" : "free"}] ${i.label}: ${i.description}`).join("\n") || "(none)"}

## Snippets (pre-written moments the user loves)
${snippets.map(s => `### ${s.title} [${s.tags.join(", ")}]\n${s.content}`).join("\n\n") || "(none)"}

## Current beat sheet
${beats.length
  ? beats
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((b, i) => {
        let line = `${i + 1}. [${(b as any).status ?? "design"}] ${b.name}: ${b.summary}`;
        if ((b as any).momentIds?.length) {
          line += `\n   Linked moments: ${(b as any).momentIds.join(", ")}`;
        }
        return line;
      })
      .join("\n")
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
- Respect the ending types: "${(story.settings as any).endingTypes?.join(", ") || (story.settings as any).endingType || "any"}".`;

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
Match the vibe "${story.settings.vibe}" and genres "${(story.settings as any).genres?.join(", ") || (story.settings as any).genre || "drama"}".
Return prose in screenplay-adjacent format. No JSON, no preamble.`;
    }

    case "brainstorm":
      return `The user wants to brainstorm: "${action.payload.prompt}"
Respond with 5 concrete, specific ideas grounded in this project's bible. Return STRICT JSON: { "ideas": [ { "title": string, "description": string } ] }`;

    case "clean_beat":
      return `The user recorded a beat description via speech-to-text. Clean it up — fix grammar, add clarity, tighten the prose — but preserve the original intent and voice. Keep it concise (2-4 sentences max).

Raw transcription: "${action.payload.rawText}"

Return STRICT JSON: { "name": string, "summary": string }
- "name" = a short beat label (2-4 words, like "The Revelation" or "First Contact")
- "summary" = the cleaned-up description`;

    case "generate_beat": {
      const p = action.payload;
      return `Generate one new beat for this story. The beat should fit naturally into the existing beat sheet at position ${p.position ?? "next"}.

Creative settings for this beat:
- Weirdness: ${p.weirdness ?? 5}/10
- Darkness: ${p.darkness ?? 5}/10
- Humor: ${p.humor ?? 3}/10
- Length: ${p.length ?? 5}/10 (1 = ultra-brief, 10 = detailed)

Existing beats for context:
${story.beats.map((b, i) => `${i + 1}. ${b.name}: ${b.summary}`).join("\n") || "(none yet)"}

Return STRICT JSON: { "name": string, "summary": string }
- "name" = a short beat label (2-4 words)
- "summary" = what happens in this beat, matching the length setting`;
    }

    case "clean_moment":
      return `The user recorded a creative moment via speech-to-text. Clean it up — fix grammar, add clarity, tighten the prose — but preserve the original intent, voice, and raw creative energy. This is a captured idea, not a polished script.

Raw transcription: "${action.payload.rawText}"

Return STRICT JSON: { "text": string }
- "text" = the cleaned-up moment`;

    default:
      return `Unknown action.`;
  }
}
