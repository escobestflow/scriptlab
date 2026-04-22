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

import { Story, Scene, getActiveConceptDraft, getActiveCharactersDraft, getActiveStoryLayerDraft, getActiveScriptDraft } from "./story";
import { ActionRequest, SYSTEM_BRAIN } from "./prompt";
import { WriterProfile, renderProfileForPrompt, isProfileMeaningful } from "./writerProfile";

export interface BuiltPrompt {
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  userMessage: string;
}

export function buildPrompt(
  story: Story,
  action: ActionRequest,
  profile?: WriterProfile | null,
): BuiltPrompt {
  const bible = storyBible(story);
  const ask = buildAsk(story, action);
  const system: BuiltPrompt["system"] = [
    { type: "text", text: SYSTEM_BRAIN, cache_control: { type: "ephemeral" } },
  ];
  // Writer profile is injected as its own cached block — it changes only
  // when the user captures new signals (not per-request), so the cache
  // stays warm across most prompts inside a session.
  if (isProfileMeaningful(profile)) {
    system.push({
      type: "text",
      text: renderProfileForPrompt(profile),
      cache_control: { type: "ephemeral" },
    });
  }
  system.push({ type: "text", text: bible, cache_control: { type: "ephemeral" } });
  return { system, userMessage: ask };
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
- Framework: ${settings.framework ?? "unspecified (let the structure fit the concept)"}
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
      return `Generate a complete beat sheet for this project${d.settings.framework ? ` using the ${d.settings.framework} framework` : `, choosing whichever structural framework best fits the concept, genre, and tone`}.

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

    // ── Cross-layer sync (Update Other Layers) ──
    // The storyBible above already contains the current active drafts of
    // every layer; these prompts just tell the model which to treat as
    // source and which schema to emit for the target.

    case "sync_concept_to_characters":
      return syncPrompt_toCharacters(story, "concept");
    case "sync_story_to_characters":
      return syncPrompt_toCharacters(story, "story");
    case "sync_script_to_characters":
      return syncPrompt_toCharacters(story, "script");

    case "sync_concept_to_story":
      return syncPrompt_toStory(story, "concept");
    case "sync_characters_to_story":
      return syncPrompt_toStory(story, "characters");
    case "sync_script_to_story":
      return syncPrompt_toStory(story, "script");

    case "sync_concept_to_script":
      return syncPrompt_toScript(story, "concept");
    case "sync_characters_to_script":
      return syncPrompt_toScript(story, "characters");
    case "sync_story_to_script":
      return syncPrompt_toScript(story, "story");

    case "sync_characters_to_concept":
      return syncPrompt_toConcept(story, "characters");
    case "sync_story_to_concept":
      return syncPrompt_toConcept(story, "story");
    case "sync_script_to_concept":
      return syncPrompt_toConcept(story, "script");

    // ── Script-import pipeline ──

    case "import_extract_scenes": {
      // Ask the model to identify scene boundaries by LINE NUMBER in the
      // source we send it. Client will slice the exact original text by
      // those line ranges, so the stored scene content is guaranteed
      // word-for-word accurate — the LLM cannot paraphrase (it never
      // emits prose, only integers).
      const raw = String(action.payload?.sourceText ?? "");
      const lines = raw.split("\n");
      const numbered = lines.map((l, i) => `[${i + 1}] ${l}`).join("\n");
      return `You are identifying scene boundaries in a screenplay. A scene starts with a slugline like "INT. LOCATION - TIME", "EXT. LOCATION - TIME", "EST. LOCATION", "INT./EXT. …", or "I/E. …" — optionally preceded by a shooting-script scene number like "1 ", "25A ", or "1. ".

Do NOT rewrite the prose. Only identify line numbers. For each scene, return:
- "headingLine": the 1-indexed line number in the source where the slugline appears.
- "heading": the slugline text, cleaned and UPPERCASED (e.g. "INT. KITCHEN - DAY"). Drop any scene-number prefix.
- "lastLine": the 1-indexed line number of the LAST line that belongs to this scene (inclusive). Typically one less than the next scene's headingLine; for the final scene it is the document's last non-empty line.

Rules:
- Do NOT invent scenes. Only identify what is actually present in the source.
- Drop everything before the first slugline (title page, author, synopsis, table of contents).
- headingLine < lastLine for every scene, and lastLine < nextScene.headingLine.
- If the document has zero scene headings, return an empty array.

Source text (1-indexed line numbers in brackets):
${numbered}

Return STRICT JSON:
{ "scenes": [ { "headingLine": number, "heading": string, "lastLine": number } ] }

No prose outside the JSON.`;
    }

    case "rewrite_highlighted_range": {
      // User highlighted a passage inside a single scene and typed an
      // instruction. We ship the full scene content as context so the
      // model understands the surrounding tone, but we only ask it to
      // rewrite the quoted passage and return that as a drop-in
      // replacement string.
      const { sceneId, selectedText, instruction } = action.payload as {
        sceneId: string;
        selectedText: string;
        instruction: string;
      };
      const sc = getActiveScriptDraft(story);
      const scene = (sc?.script.scenes ?? []).find(s => s.id === sceneId);
      if (!scene) return `Unknown scene.`;
      const PASSAGE = selectedText;
      return `Rewrite the quoted passage inside this scene per the user's instruction. Return only the rewritten passage — a drop-in replacement for the quoted text. Preserve the surrounding formatting conventions (dialogue "NAME: line" cues, action paragraphs, scene headings in ALL CAPS). Match the scene's voice and tone.
${scene.heading ? `\nScene heading: ${scene.heading}` : ""}

Full scene for context:
"""
${(scene.content || "").slice(0, 6000)}
"""

Passage to rewrite (quoted verbatim from the scene):
"""
${PASSAGE}
"""

User instruction: ${instruction}

Return STRICT JSON:
{ "replacement": string }

Rules:
- The "replacement" value is the rewritten passage ONLY — not the whole scene.
- Do not add commentary, preamble, or framing.
- Keep the replacement roughly the same length unless the instruction asks otherwise.
- Preserve any dialogue cue format (ALL CAPS name + colon) if the passage contains one.`;
    }

    case "import_summarize_scenes": {
      // Walk the active Script draft (which Step 1 just populated) and
      // ask for one beat per scene, in order. The client will zip these
      // into Beat objects 1:1 with the scenes.
      const sc = getActiveScriptDraft(story);
      const scenes = sc?.script.scenes ?? [];
      const PER_SCENE_CHARS = 2500;
      const sceneBlocks = scenes.map((s, i) => {
        const body = (s.content || "").slice(0, PER_SCENE_CHARS);
        const truncated = (s.content || "").length > PER_SCENE_CHARS
          ? "\n[…truncated for length…]" : "";
        return `### Scene ${i + 1}: ${s.heading || "(no heading)"}\n${body}${truncated}`;
      }).join("\n\n");
      return `Produce exactly ONE beat per scene, in order. There are ${scenes.length} scenes — return exactly ${scenes.length} beats in the same order.

For each beat:
- "name": a 2–5-word beat label evoking what happens (e.g. "The Meet-Cute", "First Betrayal", "Reunion"). NOT the scene heading.
- "summary": 1–2 sentences describing what actually happens in that scene, grounded in the prose below.
- "purpose": 1 sentence naming what this scene does for the audience (reveal, setup, pivot, payoff, etc.).

Scenes:

${sceneBlocks}

Return STRICT JSON:
{ "beats": [ { "name": string, "summary": string, "purpose": string } ] }

Rules:
- Exactly one beat per scene, in scene order. Do not merge or split.
- Base every beat entirely on its scene's content — do not invent details.
- No prose outside the JSON.`;
    }

    default:
      return `Unknown action.`;
  }
}

// ── Sync prompt builders ──
// Each returns a task-specific user message appended to the shared story
// bible. The model sees the bible + this ask; output is strict JSON.

function sourceLabel(source: "concept" | "characters" | "story" | "script"): string {
  return source === "concept"    ? "Concept"
       : source === "characters" ? "Characters"
       : source === "story"      ? "Story (beat sheet)"
       :                           "Script (scene prose)";
}

/**
 * Context block that always ships the existing written script prose
 * (from beat.sceneContent when status="written", and from script.scenes)
 * to any sync prompt. This is the cohesion fix: even when the user taps
 * "Update Characters from Concept", if scenes have already been written,
 * the model should see them so the derived characters line up with what
 * the script actually shows.
 *
 * Returns "" when no prose exists, so callers can concatenate safely.
 * For `source === "script"` this is the *primary* source material; for
 * every other source it's supplementary context for cohesion.
 */
function cohesionScriptBlock(story: Story, source: "concept" | "characters" | "story" | "script"): string {
  const prose = scriptProseBlock(story);
  if (!prose || prose === "(no scenes)") return "";
  if (source === "script") {
    return `\n\n## Source script prose\n${prose}`;
  }
  return `\n\n## Additional cohesion context — script prose already written\nThe project already has screenplay prose. Treat the ${sourceLabel(source)} above as the PRIMARY source of truth, but keep your output CONSISTENT with the specific characters, tone, and events shown below.\n\n${prose}`;
}

function scriptProseBlock(story: Story, maxChars = 12000): string {
  // Collect prose from two places: the ScriptLayerDraft's scenes array
  // AND any Story-layer beats with status="written" + sceneContent. The
  // app writes generated scene prose onto the beat, so beats are the
  // primary source today.
  const sc = getActiveScriptDraft(story);
  const sl = getActiveStoryLayerDraft(story);
  const chunks: string[] = [];

  if (sc) {
    for (const s of sc.script.scenes) {
      if ((s.content ?? "").trim()) {
        chunks.push(`\n\n--- ${s.heading || "SCENE"} ---\n${s.content}`);
      }
    }
  }

  if (sl) {
    const beats = story.projectType === "tv-show"
      ? (sl.episodes ?? []).flatMap(ep => ep.beats)
      : sl.beats;
    for (const b of beats) {
      if (b.status === "written" && (b.sceneContent ?? "").trim()) {
        chunks.push(`\n\n--- ${b.name || "SCENE"} ---\n${b.sceneContent}`);
      }
    }
  }

  if (!chunks.length) return "(no scenes)";

  let out = "";
  for (const chunk of chunks) {
    if (out.length + chunk.length > maxChars) {
      out += "\n\n[…truncated for length…]";
      break;
    }
    out += chunk;
  }
  return out.trim();
}

function syncPrompt_toCharacters(story: Story, source: "concept" | "story" | "script"): string {
  const sourceBlock = cohesionScriptBlock(story, source);
  return `Derive the Characters layer from the ${sourceLabel(source)} above${sourceBlock ? ", ensuring your output is cohesive with every other layer that already exists (see blocks below)" : ""}.${sourceBlock}

Produce a coherent cast of characters that plausibly anchors this project. ${
    source === "script"
      ? "List every character who speaks or is central to the action in the prose. Do NOT invent characters who do not appear."
      : source === "story"
      ? "Derive characters implied by the beat sheet — every named role plus any clearly-required unnamed roles (protagonist, antagonist, etc.)."
      : "Invent a small but specific cast (3–6 characters) that would power this concept."
  }

For each character, fill every field with a one-sentence-or-two inference grounded in the source. Do not duplicate archetypes across characters unless the story requires it.

Return STRICT JSON:
{
  "characters": [
    {
      "name": string,
      "role": string,            // "protagonist", "antagonist", "foil", "mentor", etc.
      "archetype": string,       // short label, 1–4 words
      "backstory": string,       // 1–3 sentences
      "motivations": string,     // 1 sentence
      "flaws": string,           // 1 sentence; concrete, not humblebrags
      "want": string,            // external, 1 sentence
      "need": string,            // internal, 1 sentence
      "voice": string,           // how they speak, 1 sentence
      "arc": string,             // start → end, 1–2 sentences
      "notes": string            // supplementary, 0–1 sentence (may be empty)
    }
  ]
}

No prose outside the JSON.`;
}

function syncPrompt_toStory(story: Story, source: "concept" | "characters" | "script"): string {
  const c = getActiveConceptDraft(story);
  const framework = c.settings.framework;
  const isTV = story.projectType === "tv-show";
  const sourceBlock = cohesionScriptBlock(story, source);

  if (isTV) {
    return `Derive the Story layer (beat sheet) for this TV project from the ${sourceLabel(source)} above${sourceBlock ? ", ensuring cohesion with every other layer that already exists (see blocks below)" : ""}.${sourceBlock}

${source === "script"
  ? "Extract the beat structure implicit in the scene prose."
  : framework
    ? `Use the ${framework} framework.`
    : "Choose whichever structural framework best fits the concept and genre, and apply it consistently."} Return a single pilot episode's worth of beats (one episode).

Return STRICT JSON:
{
  "beats": [
    { "name": string, "summary": string, "purpose": string }
  ]
}

Rules:
- 8–15 beats.
- Each "summary" is 1–2 sentences; each "purpose" is 1 sentence naming what the beat does for the audience.
- No prose outside the JSON.`;
  }

  return `Derive the Story layer (beat sheet) from the ${sourceLabel(source)} above${sourceBlock ? ", ensuring cohesion with every other layer that already exists (see blocks below)" : ""}.${sourceBlock}

${source === "script"
  ? "Extract the beat structure implicit in the scene prose — one beat per narrative turn, not per scene."
  : framework
    ? `Use the ${framework} framework to produce the full beat sheet.`
    : "Choose whichever structural framework best fits the concept and genre, and produce the full beat sheet under it."}

Return STRICT JSON:
{
  "beats": [
    { "name": string, "summary": string, "purpose": string }
  ]
}

Rules:
- Produce a complete ${framework === "save-the-cat" ? "15-beat" : "full"} structure for a feature unless the source indicates a different scope.
- Each "summary" is 1–2 sentences; each "purpose" is 1 sentence.
- No prose outside the JSON.`;
}

function syncPrompt_toScript(story: Story, source: "concept" | "characters" | "story"): string {
  const c = getActiveConceptDraft(story);
  const genres = c.settings.genres?.join(", ") || "drama";
  const isShort = story.projectType === "short";
  const targetScenes =
    source === "story"
      ? "one scene per beat in the beat sheet above"
      : isShort
      ? "6–10 scenes"
      : "14–22 scenes";
  // When generating a fresh script but a prior script already exists,
  // include the prior prose as tonal/character reference so the new
  // draft feels cohesive with what the user has seen.
  const existingProse = scriptProseBlock(story);
  const priorScriptBlock =
    existingProse && existingProse !== "(no scenes)"
      ? `\n\n## Prior script prose (for tonal reference only)\nA prior version of this script exists. Treat it as reference for the project's voice, characters, and tone. You are writing a fresh take driven by the ${sourceLabel(source)} — feel free to restructure — but keep character names and established tone consistent.\n\n${existingProse}`
      : "";

  return `Write a complete ${isShort ? "short-film" : story.projectType === "tv-show" ? "pilot-episode" : "feature-length"} screenplay driven by the ${sourceLabel(source)} above.

Produce ${targetScenes}. Match the genres "${genres}" and the tone on the brief.

${source !== "story" ? "No beat sheet has been written yet, so synthesize coherent scene structure as you go. The user will back-fill the Story layer separately." : ""}${priorScriptBlock}

Return STRICT JSON:
{
  "scenes": [
    {
      "heading": string,   // slugline, e.g. "INT. DINER - NIGHT"
      "content": string    // screenplay-style prose for the scene: action lines + dialogue in industry format (CHARACTER in caps, dialogue below)
    }
  ]
}

Formatting rules inside each "content":
- Action lines in present tense, concrete and sensory.
- Dialogue cues as CHARACTER NAME on its own line, followed by the line.
- No scene numbering; no "FADE IN/OUT" surrounding the scenes.
- Keep each scene 100–400 words.

No prose outside the JSON.`;
}

function syncPrompt_toConcept(story: Story, source: "characters" | "story" | "script"): string {
  const sourceBlock = cohesionScriptBlock(story, source);
  return `Derive a refreshed Concept layer from the ${sourceLabel(source)} above${sourceBlock ? ", ensuring cohesion with every other layer that already exists (see blocks below)" : ""}.${sourceBlock}

The project's **title, format, and genres are fixed** — the user chose these at creation and they are NOT to be reconsidered. Do not include them in the output.

Write concept content that accurately reflects what exists in the source material. Each field:
- logline: 1–2 sentences, ≤40 words. Protagonist + inciting event + goal + conflict + stakes.
- summary: 3–5 sentences, ~80 words. World → protagonist → inciting event → central tension → thematic undertow.
- tone: short evocative phrase (2–6 words), e.g. "bone-dry deadpan", "neon-lit dread".
- themes: 3–5 punchy noun phrases (1–3 words each).
- endingTypes: 1 or 2 entries from: "happy" | "bittersweet" | "tragic" | "ambiguous" | "twist" — whichever best fits what the source suggests.

Return STRICT JSON:
{
  "logline": string,
  "summary": string,
  "tone": string,
  "themes": string[],
  "endingTypes": ("happy" | "bittersweet" | "tragic" | "ambiguous" | "twist")[]
}

No prose outside the JSON.`;
}
