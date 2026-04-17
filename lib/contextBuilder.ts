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

import { Story, getActiveConceptDraft, getActiveCharactersDraft, getActiveStoryLayerDraft, getActiveScriptDraft } from "./story";
import { ActionRequest, SYSTEM_BRAIN } from "./prompt";

export interface BuiltPrompt {
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  userMessage: string;
}

export function buildPrompt(story: Story, action: ActionRequest): BuiltPrompt {
  const bible = storyBible(story);
  const ask = buildAsk(story, action);
  return {
    system: [
      { type: "text", text: SYSTEM_BRAIN, cache_control: { type: "ephemeral" } },
      { type: "text", text: bible, cache_control: { type: "ephemeral" } },
    ],
    userMessage: ask,
  };
}

function storyBible(story: Story): string {
  const c  = getActiveConceptDraft(story);
  const ch = getActiveCharactersDraft(story);
  const sl = getActiveStoryLayerDraft(story);
  const { settings, concept, logline } = c;
  const { characters } = ch;
  const { ingredients, snippets, beats } = sl;
  return `# CURRENT PROJECT BIBLE

## Title
${story.title || "(untitled)"}

## Logline
${logline || "(none yet)"}

## Concept
- Summary: ${concept?.summary || "(none)"}
- Tone: ${concept?.tone || "(none)"}
- Themes: ${concept?.themes?.join(", ") || "(none)"}

## Settings
- Framework: ${settings.framework}
- Genres: ${settings.genres?.join(", ") || "none"}
- Vibe: ${settings.vibe}
- Unpredictability: ${settings.unpredictability}/10
- Darkness: ${settings.darkness}/10
- Pace: ${settings.pace}/10
- Ending types: ${settings.endingTypes?.join(", ") || "none"}

## Characters
${characters.map(c => {
  let line = `- ${c.name} (${c.role})`;
  if (c.archetype) line += ` [${c.archetype}]`;
  line += ` — wants: ${c.want}; needs: ${c.need}`;
  if (c.motivations) line += `; motivations: ${c.motivations}`;
  if (c.flaws) line += `; flaws: ${c.flaws}`;
  if (c.voice) line += `; voice: ${c.voice}`;
  if (c.arc) line += `; arc: ${c.arc}`;
  if (c.notes) line += `; ${c.notes}`;
  return line;
}).join("\n") || "(none)"}

## Ingredients
${ingredients.map(i => `- [${i.locked ? "LOCKED" : "free"}] ${i.label}: ${i.description}`).join("\n") || "(none)"}

## Snippets (pre-written moments the user loves)
${snippets.map(s => `### ${s.title} [${s.tags.join(", ")}]\n${s.content}`).join("\n\n") || "(none)"}

## Current beat sheet
${beats.length
  ? beats
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((b, i) => {
        let line = `${i + 1}. [${b.status ?? "design"}] ${b.name}: ${b.summary}`;
        if (b.momentIds?.length) {
          line += `\n   Linked moments: ${b.momentIds.join(", ")}`;
        }
        return line;
      })
      .join("\n")
  : "(no beats yet)"}
`;
}

function buildAsk(story: Story, action: ActionRequest): string {
  const c  = getActiveConceptDraft(story);
  const sl = getActiveStoryLayerDraft(story);
  // Compatibility shim so existing switch cases compile with minimal change:
  const d = { ...c, ...sl };
  switch (action.type) {
    case "generate_beats":
      return `Generate a complete beat sheet for this project using the ${d.settings.framework} framework.

Return STRICT JSON in this exact schema:
{ "beats": [ { "name": string, "summary": string, "purpose": string } ] }

Rules:
- Use every locked ingredient meaningfully.
- Weave in at least one snippet where it fits naturally (reference by title in the purpose field).
- Match the darkness/pace/unpredictability levels.
- Respect the ending types: "${d.settings.endingTypes?.join(", ") || "any"}".`;

    case "swap_ingredient": {
      const id = action.payload.ingredientId;
      const ing = d.ingredients.find(i => i.id === id);
      return `Suggest 3 replacement options for the ingredient labeled "${ing?.label}" (currently: "${ing?.description}"). Keep the same structural role but push the unpredictability level (${d.settings.unpredictability}/10).

Return STRICT JSON: { "options": [ { "label": string, "description": string, "why": string } ] }`;
    }

    case "add_twist":
      return `Propose a twist to inject into the current beat sheet. Target unpredictability: ${d.settings.unpredictability}/10.

Return STRICT JSON: { "twist": { "insertAfterBeat": number, "description": string, "ripple": string } }
- "ripple" explains which later beats need to shift and how.`;

    case "rewrite_beat": {
      const idx = action.payload.beatIndex;
      const instruction = action.payload.instruction ?? "make it sharper";
      const beat = d.beats[idx];
      return `Rewrite beat #${idx + 1} ("${beat?.name}"). Current summary: "${beat?.summary}"

Instruction: ${instruction}

Return STRICT JSON: { "beat": { "name": string, "summary": string, "purpose": string } }`;
    }

    case "generate_scene": {
      const idx = action.payload.beatIndex;
      const beat = d.beats[idx];
      return `Write the full scene for beat #${idx + 1} ("${beat?.name}" — ${beat?.summary}).
Match the vibe "${d.settings.vibe}" and genres "${d.settings.genres?.join(", ") || "drama"}".
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
${d.beats.map((b, i) => `${i + 1}. ${b.name}: ${b.summary}`).join("\n") || "(none yet)"}

Return STRICT JSON: { "name": string, "summary": string }
- "name" = a short beat label (2-4 words)
- "summary" = what happens in this beat, matching the length setting`;
    }

    case "clean_moment":
      return `The user recorded a creative moment via speech-to-text. Clean it up — fix grammar, add clarity, tighten the prose — but preserve the original intent, voice, and raw creative energy. This is a captured idea, not a polished script.

Raw transcription: "${action.payload.rawText}"

Return STRICT JSON: { "text": string }
- "text" = the cleaned-up moment`;

    // ── Concept-tab per-field generators ──
    // Each uses the full concept bible as context so generated values
    // cohere with the user's existing choices. All return strict JSON.

    case "generate_concept_title":
      return `Generate ONE evocative working title for this project.
Use the existing concept (format, genre, logline, summary, tone, themes, ending) above as the guiding brief. Titles should be short (1–5 words), cinematic, and memorable — not generic, not on-the-nose.

Return STRICT JSON: { "title": string }
- "title" = the single best option (not a list)`;

    case "generate_concept_logline":
      return `Write ONE logline for this project in 1–2 sentences, max 40 words.
Use the existing concept (format, genre, title, summary, tone, themes, ending) above as the brief. A great logline contains: protagonist, inciting event, goal, central conflict, and stakes. Specificity beats abstraction. No adjective-stuffing.

Return STRICT JSON: { "logline": string }`;

    case "generate_concept_summary":
      return `Write a premise/summary for this project. 3–5 sentences, ~80 words.
Use the existing concept (format, genre, title, logline, tone, themes, ending) as the brief. The summary should establish world → protagonist → inciting event → central tension → thematic undertow. Prose, not outline. No headers, no bullets.

Return STRICT JSON: { "summary": string }`;

    case "generate_concept_tone":
      return `Pick ONE tone descriptor for this project.
Use the existing concept (format, genre, title, logline, summary, themes, ending) as the brief. The tone should be a short evocative phrase (2–6 words) that would guide a writer's room — e.g. "bone-dry deadpan", "neon-lit dread", "sun-bleached melancholy".

Return STRICT JSON: { "tone": string }`;

    case "generate_concept_themes":
      return `Propose 3–5 thematic throughlines for this project.
Use the existing concept (format, genre, title, logline, summary, tone, ending) as the brief. Themes should be punchy noun phrases (1–3 words each) — e.g. "grief", "inherited violence", "the cost of ambition". Avoid clichés and single-word banalities like "love" or "family" unless genuinely central. No duplicates of themes already present: ${d.concept?.themes?.length ? d.concept.themes.join(", ") : "(none yet)"}.

Return STRICT JSON: { "themes": string[] }`;

    case "generate_concept_ending": {
      const existing = d.settings.endingTypes?.join(", ") || "(none yet)";
      return `Pick the single most fitting ending type for this project from: happy, bittersweet, tragic, ambiguous, twist.
Use the existing concept (format, genre, title, logline, summary, tone, themes) as the brief. The ending already selected is: ${existing}. Choose the one option that best matches the emotional logic of what's here — do not default to bittersweet unless the material earns it.

Return STRICT JSON: { "ending": "happy" | "bittersweet" | "tragic" | "ambiguous" | "twist" }`;
    }

    // ── Character-tab per-field generators ──
    // The project bible above already includes all characters. The prompt
    // targets ONE character by id and asks for a single field, using:
    //   (a) the full concept (format, genre, logline, summary, tone, themes, ending)
    //   (b) all other characters in this draft (to avoid duplication / stay coherent)
    //   (c) the target character's other fields that are already filled
    case "generate_character_name":
    case "generate_character_archetype":
    case "generate_character_backstory":
    case "generate_character_motivations":
    case "generate_character_flaws":
    case "generate_character_want":
    case "generate_character_need":
    case "generate_character_voice":
    case "generate_character_arc":
    case "generate_character_notes": {
      const ch = getActiveCharactersDraft(story);
      const charId = action.payload?.characterId;
      const target = ch.characters.find(c => c.id === charId);
      if (!target) return `Unknown character.`;

      // Map action → { fieldName, description, returnKey, format }
      const fieldMap: Record<string, { field: string; guidance: string; returnKey: string; returnType: string }> = {
        "generate_character_name":        { field: "name",        returnKey: "name",        returnType: "string", guidance: "A specific character name (given + optional last name). Fits the genre, tone, and period. Avoid generic placeholder names." },
        "generate_character_archetype":   { field: "archetype",   returnKey: "archetype",   returnType: "string", guidance: "A single archetype label (1–4 words). E.g. 'reluctant mentor', 'unreliable narrator', 'tragic villain'. Match the character's role and the story's tone." },
        "generate_character_backstory":   { field: "backstory",   returnKey: "backstory",   returnType: "string", guidance: "2–4 sentences of the character's history that inform who they are now. Concrete and sensory, not abstract." },
        "generate_character_motivations": { field: "motivations", returnKey: "motivations", returnType: "string", guidance: "1–2 sentences on what drives them. Should tie to their want/need when already set." },
        "generate_character_flaws":       { field: "flaws",       returnKey: "flaws",       returnType: "string", guidance: "1–2 sentences naming 1–2 genuine flaws that could derail them. Avoid humblebrags ('cares too much')." },
        "generate_character_want":        { field: "want",        returnKey: "want",        returnType: "string", guidance: "The external, concrete objective (1 sentence). The thing they would say out loud. Should be contradictable by their 'need'." },
        "generate_character_need":        { field: "need",        returnKey: "need",        returnType: "string", guidance: "The internal truth they must learn (1 sentence). Often in tension with their want." },
        "generate_character_voice":       { field: "voice",       returnKey: "voice",       returnType: "string", guidance: "1–2 sentences on how they speak — cadence, diction, typical verbal tics. Evocative." },
        "generate_character_arc":         { field: "arc",         returnKey: "arc",         returnType: "string", guidance: "1–3 sentences mapping who they are at start → end. Concrete beats, not abstractions." },
        "generate_character_notes":       { field: "notes",       returnKey: "notes",       returnType: "string", guidance: "Any useful supplementary detail — physicality, iconic object, defining habit — in 1–2 sentences." },
      };
      const spec = fieldMap[action.type];

      // Serialize target character's other filled fields so the model can build on them.
      const existing: string[] = [];
      if (target.name && spec.field !== "name")               existing.push(`- name: ${target.name}`);
      if (target.role && spec.field !== "role")               existing.push(`- role: ${target.role}`);
      if (target.archetype && spec.field !== "archetype")     existing.push(`- archetype: ${target.archetype}`);
      if (target.backstory && spec.field !== "backstory")     existing.push(`- backstory: ${target.backstory}`);
      if (target.motivations && spec.field !== "motivations") existing.push(`- motivations: ${target.motivations}`);
      if (target.flaws && spec.field !== "flaws")             existing.push(`- flaws: ${target.flaws}`);
      if (target.want && spec.field !== "want")               existing.push(`- want: ${target.want}`);
      if (target.need && spec.field !== "need")               existing.push(`- need: ${target.need}`);
      if (target.voice && spec.field !== "voice")             existing.push(`- voice: ${target.voice}`);
      if (target.arc && spec.field !== "arc")                 existing.push(`- arc: ${target.arc}`);
      if (target.notes && spec.field !== "notes")             existing.push(`- notes: ${target.notes}`);

      const existingBlock = existing.length
        ? existing.join("\n")
        : "(only the role is set — generate from story context)";

      // Other characters (to avoid duplicating archetypes/voices)
      const others = ch.characters
        .filter(c => c.id !== target.id)
        .map(c => `- ${c.name || "(unnamed)"} [${c.role}]${c.archetype ? ` — ${c.archetype}` : ""}`)
        .join("\n") || "(none)";

      return `Generate the "${spec.field}" field for ONE character in this project.

## Target character (existing fields)
- id: ${target.id}
- role: ${target.role}
${existingBlock}

## Other characters in this project
${others}

## Guidance
${spec.guidance}

Use the full project bible above (format, genre, logline, summary, tone, themes, ending) and the target character's existing fields to make the output cohere. Do not contradict anything already set.

Return STRICT JSON: { "${spec.returnKey}": ${spec.returnType} }`;
    }

    default:
      return `Unknown action.`;
  }
}
