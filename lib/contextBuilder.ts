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

import {
  Story, Scene, Character, Snippet, EpisodeArchetype,
  getActiveConceptDraft, getActiveCharactersDraft, getActiveStoryLayerDraft, getActiveScriptDraft, getActiveEpisodesDraft,
  // Arc wiring (Phase 2): season arcs flow into the bible + per-episode
  // prompts as instructions, not just storage. The digest collapses the
  // 20-arc-by-N-episode score matrix into "what matters for THIS ep."
  getActiveArcsDraft, getEpisodeCountForArcs, digestArcsForEpisode, formatArcDigest,
  ARC_TYPE_LABELS,
  // Series-type wiring: each TV project declares what kind of show it
  // is, which reshapes episode independence / arc continuity / ending
  // posture. SERIES_TYPE_RULES is the per-type instruction block we
  // inject into every prompt.
  SERIES_TYPE_LABELS, SERIES_TYPE_DESCRIPTIONS, SERIES_TYPE_RULES,
} from "./story";
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

/** Render a single beat list as the bible's `## Current beat sheet` body.
 *  Extracted so the TV path can call it once per episode while feature/
 *  short paths render the project-level beats inline. */
function renderBeatLines(
  beats: import("./story").Beat[],
  characters: Character[],
  snippets: Snippet[],
): string {
  if (!beats.length) return "(no beats yet)";
  return beats
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((b, i) => {
      const lines: string[] = [];
      lines.push(`${i + 1}. [${b.status ?? "design"}] ${b.name}: ${b.summary}`);
      if (b.purpose) lines.push(`   Purpose: ${b.purpose}`);
      const dials: string[] = [];
      if (typeof b.twist === "number") dials.push(`Twist ${b.twist}/10`);
      if (typeof b.weirdness === "number") dials.push(`Weirdness ${b.weirdness}/10`);
      if (dials.length) lines.push(`   Per-scene dials: ${dials.join(" · ")}`);
      if (b.characterIds?.length) {
        const names = b.characterIds
          .map(id => characters.find(c => c.id === id)?.name)
          .filter(Boolean) as string[];
        if (names.length) lines.push(`   Cast in scene: ${names.join(", ")}`);
      }
      if (b.momentIds?.length) {
        const linked = b.momentIds
          .map(id => snippets.find(s => s.id === id))
          .filter(Boolean) as Snippet[];
        if (linked.length) {
          lines.push(`   Linked ideas to weave into this scene:`);
          for (const m of linked) {
            const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
            lines.push(`     • ${m.title}${tags}: ${m.content}`);
          }
        }
      }
      return lines.join("\n");
    })
    .join("\n");
}

/** Render the TV "Series type" block embedded in the bible. Names
 *  the type, gives the canonical definition the writer also sees in
 *  the picker, and lists the structural rules the model MUST obey.
 *  Returns "" for non-TV or when seriesType is unset — caller can
 *  append unconditionally. */
function renderSeriesTypeBlock(story: Story): string {
  if (story.projectType !== "tv-show") return "";
  const c = getActiveConceptDraft(story);
  const t = c.settings.seriesType;
  if (!t) return "";
  const label = SERIES_TYPE_LABELS[t];
  const def = SERIES_TYPE_DESCRIPTIONS[t];
  const rules = SERIES_TYPE_RULES[t];
  return `

## Series type: ${label} (HIGH PRIORITY — applies to every episode generation)
Definition: ${def}

Structural rules for this series type — these are NOT suggestions, they are constraints. Every episode / beat / scene you generate must obey them:
  - ${rules}
`;
}

/** Render the TV "Season arcs" block embedded in the bible. Lists
 *  every arc (any tier) with its type, title, description, and
 *  per-episode intensity strip so the model has the full season-
 *  shaped plan, not just the current episode's slice. Per-episode
 *  digesting happens in `tvEpisodeContext`; this is the structural
 *  catalog the digest references.
 *
 *  Returns "" for non-TV or projects with no arcs draft yet — caller
 *  appends unconditionally. */
function renderSeasonArcs(story: Story): string {
  if (story.projectType !== "tv-show") return "";
  const active = getActiveArcsDraft(story);
  if (!active || active.arcs.length === 0) return "";
  const characters = getActiveCharactersDraft(story).characters;
  const episodeCount = getEpisodeCountForArcs(story);
  // Character arcs that haven't had intensity set yet are intentionally
  // OMITTED from the bible — they're still scaffolds in the writer's
  // head, not commitments. Matches the ArcGraph filter so the bible's
  // view of the season agrees with what the user sees on the canvas.
  const arcs = active.arcs.filter(a => a.type !== "character" || a.intensitySet === true);
  if (arcs.length === 0) return "";
  const lines: string[] = [
    "",
    "## Season arcs (HIGH PRIORITY — these are the writer's structural plan for the season)",
    "Each arc carries: a TYPE (which determines the kind of beat it pushes for), a per-episode intensity 1–10 (how prominent this arc should be in that episode), and any hard moments anchored to specific episodes. When generating episode content, weight beats / scenes by the active arcs and their intensity at that episode. Hard moments are NOT optional — they must land in the episode they're anchored to.",
    "",
  ];
  for (const arc of arcs) {
    const typeLabel = ARC_TYPE_LABELS[arc.type];
    const title = arc.title?.trim() || typeLabel;
    const linkedChar = arc.characterId
      ? characters.find(c => c.id === arc.characterId)
      : undefined;
    const charLine = linkedChar ? ` · linked character: ${linkedChar.name || "Unnamed"}` : "";
    lines.push(`### ${title} [${typeLabel}]${charLine}`);
    if (arc.description?.trim()) {
      lines.push(arc.description.trim());
    }
    // Intensity strip — capped at the actual episode count so a project
    // with 9 episodes and a 12-slot scores array (legacy non-destructive
    // shrink) doesn't dump phantom episodes into the prompt.
    const strip = arc.scores
      .slice(0, episodeCount)
      .map((s, i) => `EP${i + 1}:${s}`)
      .join("  ");
    lines.push(`Intensity by episode: ${strip}`);
    // Moments — chronological, with display text resolved if linked.
    const moments = [...(arc.moments ?? [])].sort((a, b) => a.position - b.position);
    if (moments.length > 0) {
      lines.push("Hard moments:");
      for (const m of moments) {
        const epLabel = `EP${Math.floor(m.position) + 1}`;
        const txt = m.text.trim() || "(linked idea — see Ideas pool)";
        lines.push(`  • ${epLabel}: ${txt}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function storyBible(story: Story): string {
  const c  = getActiveConceptDraft(story);
  const ch = getActiveCharactersDraft(story);
  const sl = getActiveStoryLayerDraft(story);
  const { settings, concept, logline } = c;
  const { characters } = ch;
  const { ingredients, snippets, beats } = sl;
  const isTV = story.projectType === "tv-show";
  const episodes = sl.episodes ?? [];
  return `# CURRENT PROJECT BIBLE

## Title
${story.title || "(untitled)"}

## Logline
${logline || "(none yet)"}

## Concept
- Summary: ${concept?.summary || "(none)"}
- Tone: ${concept?.tone || "(none)"}${settings.toneNote?.trim() ? `\n  User direction on tone (high-priority — elaborates on the picker): "${settings.toneNote.trim()}"` : ""}
- Themes: ${concept?.themes?.join(", ") || "(none)"}${settings.themesNote?.trim() ? `\n  User direction on themes (high-priority — elaborates on the picker): "${settings.themesNote.trim()}"` : ""}

## Settings
- Framework: ${settings.framework ?? "unspecified (let the structure fit the concept)"}${settings.frameworkNote?.trim() ? `\n  User direction on framework (high-priority — elaborates on the picker): "${settings.frameworkNote.trim()}"` : ""}
- Genres: ${settings.genres?.join(", ") || "none"}
- Sub-genres: ${settings.subGenres?.length ? settings.subGenres.join(", ") : "none"}
- Writer voices to echo (study their craft, do not pastiche): ${settings.writerStyles?.length ? settings.writerStyles.join(", ") : "none"}
- References (titles to mirror, with the aspects to borrow): ${settings.references?.length ? settings.references.map(r => `"${r.title}"${r.aspects?.length ? ` — ${r.aspects.join(", ")}` : ""}`).join("; ") : "none"}
- Vibe: ${settings.vibe}
- Unpredictability: ${settings.unpredictability}/10
- Darkness: ${settings.darkness}/10
- Pace: ${settings.pace}/10
- Ending types: ${settings.endingTypes?.join(", ") || "none"}${settings.endingNote?.trim() ? `\n  User direction on ending (high-priority — elaborates on the picker): "${settings.endingNote.trim()}"` : ""}
${story.projectType === "short" ? `
## Short-film parameters
- Target duration: ${settings.duration ? `${settings.duration} min` : "unspecified (default 10–15 min)"}
- Short structure: ${settings.shortStructure ?? "unspecified (default flexible Situation → Pressure → Shift)"}
` : ""}${isTV ? renderSeriesTypeBlock(story) : ""}${isTV && concept?.seriesArc?.trim() ? `
## Season Arc (HIGH PRIORITY — applies to every episode generation)
The user has authored a season-level arc. Every individual episode you
generate or modify must serve this arc. Earlier episodes seed setups
referenced here; later episodes pay off threads opened earlier; the
finale lands the arc's resolution. When generating an episode in
isolation, internalize where in the arc this episode sits and pace
accordingly.

${concept.seriesArc.trim()}
` : ""}${isTV ? renderSeasonArcs(story) : ""}

## Characters
${characters.map(c => {
  let line = `- ${c.name} (${c.role})`;
  if (c.archetype) line += ` [${c.archetype}]`;
  line += ` — wants: ${c.want}; needs: ${c.need}`;
  if (c.motivations) line += `; motivations: ${c.motivations}`;
  if (c.flaws) line += `; flaws: ${c.flaws}`;
  if (c.voice) line += `; voice: ${c.voice}`;
  if (c.arc) line += `; arc: ${c.arc}`;
  if (c.backstory) line += `; backstory: ${c.backstory}`;
  if (c.notes) line += `; ${c.notes}`;
  return line;
}).join("\n") || "(none)"}

## Ingredients
${ingredients.map(i => `- [${i.locked ? "LOCKED" : "free"}] ${i.label}: ${i.description}`).join("\n") || "(none)"}

## Snippets (pre-written moments the user loves)
${snippets.map(s => `### ${s.title} [${s.tags.join(", ")}]\n${s.content}`).join("\n\n") || "(none)"}

${isTV
  ? `## Series structure
This project is a continuous TV series — Concept and Characters above are shared across every episode, and each episode below builds on whatever came before it. When generating new material for one episode, treat earlier episodes as established canon (events have happened, characters have evolved); when generating material for a later episode, do not contradict prior beats.

## Episode list
${episodes.length
    ? episodes
        .map(ep => `- Episode ${ep.number} — "${ep.title}" (${ep.beats.length} ${ep.beats.length === 1 ? "beat" : "beats"})`)
        .join("\n")
    : "(no episodes yet)"}

## Beat sheets per episode
${episodes.length
    ? episodes
        .map(ep => `### Episode ${ep.number} — "${ep.title}"\n${renderBeatLines(ep.beats, characters, snippets)}`)
        .join("\n\n")
    : "(no beats yet)"}
`
  : `## Current beat sheet
${renderBeatLines(beats, characters, snippets)}
`}`;
}

// ── Short-film helpers ────────────────────────────────────────────
// Shared between generate_beats, sync_*_to_story, sync_*_to_script, and
// the Easy-mode generate_full_concept prompts.

/** Target scene count for a short. Maps the user's chosen runtime onto
 *  one of seven duration buckets, each carrying its own scene/beat range.
 *  Default bucket = 8–12 min when duration is unset (≈ 7–12 scenes).
 *  Returns the low/high inclusive range plus a presentation string ready
 *  to splice into prompt text (e.g. "10–15 scenes"). */
function shortSceneCount(durationMin: number | undefined): { low: number; high: number; label: string } {
  const dur = typeof durationMin === "number" && durationMin > 0 ? durationMin : 12;
  let low = 7, high = 12;
  if (dur <= 3)        { low = 2;  high = 4;  }
  else if (dur <= 5)   { low = 3;  high = 6;  }
  else if (dur <= 8)   { low = 5;  high = 8;  }
  else if (dur <= 12)  { low = 7;  high = 12; }
  else if (dur <= 15)  { low = 10; high = 15; }
  else if (dur <= 20)  { low = 12; high = 20; }
  else                 { low = 15; high = 30; }
  return { low, high, label: `${low}–${high} scenes` };
}

/** Per-shortStructure ending posture. Returns empty string when the
 *  user hasn't picked one — the generic 3-stage skeleton in
 *  shortFilmGuidance is enough on its own. */
function shortStructureFlavor(s: string | null | undefined): string {
  switch (s) {
    case "complete":
      return "End on a clear resolution — the situation set up in stage 1 is fully addressed. The shift is conclusive.";
    case "open-ended":
      return "End on emotional clarity, not plot resolution. The character feels different at the end; the world's outcome is left open.";
    case "proof-of-concept":
      return "End on a hook that implies a larger story. The shift suggests scope rather than resolution — this is a tone/world piece for a bigger work.";
    case "slice-of-life":
      return "Stay observational. The shift can be small or interior — a realization, not a plot beat. No forced climax.";
    case "twist":
      return "Withhold one key piece of information until the final scene. The shift is a reveal that recontextualizes everything that came before.";
    default:
      return "";
  }
}

/** The block of guidance we splice into every short-form generation
 *  prompt. Empty string for non-shorts so callers can append
 *  unconditionally. */
function shortFilmGuidance(story: Story): string {
  if (story.projectType !== "short") return "";
  const settings = getActiveConceptDraft(story).settings;
  const { low, high } = shortSceneCount(settings.duration);
  const dur = settings.duration ?? 12;
  const flavor = shortStructureFlavor(settings.shortStructure);
  return `
This is a short film, not a feature. Target runtime ~${dur} minutes → about ${low}–${high} scenes total.

Do NOT use a full feature-length arc. Use a flexible 3-stage skeleton:
  1. Situation — drop us into a clear world / problem / relationship / tension.
  2. Pressure — something pushes the character into a decision, reaction, or exposure.
  3. Shift — something changes (external, emotional, moral, comic, or symbolic).
${flavor ? `\n${flavor}` : ""}`;
}

// User-supplied free-text steering for the active story-layer draft. When
// present, gets injected at the END of beat-generation prompts so it carries
// the most recency weight against the structural rules above. Empty when
// the user has not typed any direction.
function directionBlock(story: Story): string {
  const sl = getActiveStoryLayerDraft(story);
  const dir = (sl?.direction ?? "").trim();
  if (!dir) return "";
  return `

USER DIRECTION (high-priority guidance from the writer for this beat sheet — follow it; if it conflicts with the structural defaults above, the user direction wins):
"""
${dir}
"""`;
}

// Maps each EpisodeArchetype to a one-paragraph structural template
// hint. Used by tvEpisodeContext below. Empty string when the user
// hasn't picked one — the model uses a generic shape in that case.
function episodeArchetypeFlavor(a: EpisodeArchetype | undefined): string {
  switch (a) {
    case "case-of-the-week":
      return "ARCHETYPE: Case of the Week. Self-contained A-plot opens and resolves within this episode. Mythology can simmer in the B-plot but doesn't have to land. End on a turn that points forward, not a hard cliffhanger.";
    case "myth-arc":
      return "ARCHETYPE: Myth-arc / serialized. This episode advances the season's spine 1–2 meaningful steps. Leave threads OPEN. End on an escalation that demands the next episode.";
    case "bottle":
      return "ARCHETYPE: Bottle episode. Minimal locations (one or two interiors); minimal new characters; character-driven and emotion-forward. Conflict is interior or interpersonal, not plot-driven. Pace slowly; let scenes breathe.";
    case "character-study":
      return "ARCHETYPE: Character study. One character at the center; the season arc takes a back seat. Reveal interior life through specific decisions, memories, or relationships. The episode's payoff is emotional understanding, not plot advancement.";
    case "flashback":
      return "ARCHETYPE: Flashback / origin. Temporal split — present-day frame opens and closes; the middle is the past. The past-era scenes should adopt a slightly different voice (older characters, different setting, different stakes). The frame's job is to re-contextualize what we already know about the present.";
    case "season-premiere":
      return "ARCHETYPE: Season premiere. Re-establish the world after a time jump or a finale's fallout. Re-meet each major character through what's CHANGED for them, not exposition dumps. End on a question that the rest of the season will answer.";
    case "season-finale":
      return "ARCHETYPE: Season finale. Pay off, don't seed. The season arc resolves (in the chosen ending mode); characters land in a new emotional place; the audience should feel the season closing. Cliffhangers are optional — pick one based on whether there's a clear next-season hook.";
    default:
      return "";
  }
}

/** TV-episode context block. Injected into TV beat-gen + sync prompts
 *  when the client passes `episodeId` in the action payload.
 *
 *  Composition:
 *    1. WHICH EPISODE — position (N of M), archetype hint, logline.
 *    2. PRIOR EPISODES — compressed summary of episodes 1..N-1.
 *       Each prior episode emits its number/title/logline plus a
 *       2-line beat summary. Keeps the prompt under 2K tokens per
 *       episode even at high season counts.
 *
 *  Returns "" when the story isn't TV, the episode id doesn't match,
 *  or no episodes exist. Callers can append unconditionally. */
function tvEpisodeContext(story: Story, episodeId: string | undefined): string {
  if (story.projectType !== "tv-show" || !episodeId) return "";
  const epd = getActiveEpisodesDraft(story);
  if (!epd) return "";
  const sorted = [...epd.episodes].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const idx = sorted.findIndex(e => e.id === episodeId);
  if (idx < 0) return "";
  const total = sorted.length;
  const me = sorted[idx];

  // Position phrase. Total can be 1 (just the pilot, treat as premiere)
  // or large (mid-season nuance). Pilot = ep 1; finale = last ep when
  // there are 2+ episodes total; middle = everything else.
  const position =
    total === 1                ? `This is the ONLY episode in the season. Treat it as both opener and standalone.` :
    idx === 0                  ? `This is Episode 1 of ${total} planned — the PILOT. Front-load setup; introduce the world, the central conflict, the protagonist's stakes. End on a hook strong enough to demand Episode 2.` :
    idx === total - 1          ? `This is Episode ${me.number} of ${total} — the FINALE. Pay off the season's arcs; don't seed new ones (unless there's a clear next-season hook). The audience should feel the arc closing.` :
                                 `This is Episode ${me.number} of ${total} — a MIDDLE episode. Escalate from the previous episode; advance the season arc 1–2 meaningful steps; end on a turn.`;

  // Archetype hint (optional, user-tagged).
  const archetype = episodeArchetypeFlavor(me.archetype);

  // Previously-on. For each prior episode, emit number/title/logline
  // and a compressed beat list. Cap each episode's beat block at
  // 6 beats (head + tail) so the prompt scales gracefully across a
  // 20-episode season.
  const compressBeats = (beats: typeof me.beats): string => {
    if (!beats || beats.length === 0) return "(no beats written yet)";
    const slim = beats.length <= 6
      ? beats
      : [...beats.slice(0, 4), ...beats.slice(-2)];
    return slim.map(b => `  • ${b.name}${b.summary ? ` — ${b.summary}` : ""}`).join("\n");
  };
  const prior = sorted.slice(0, idx);
  const previouslyOn = prior.length === 0
    ? ""
    : `

## Previously-on (the episodes that come BEFORE the one you're writing)
${prior.map(ep => `### Episode ${ep.number} — ${ep.title?.trim() || "(untitled)"}
Logline: ${ep.logline?.trim() || "(none)"}
Beats:
${compressBeats(ep.beats)}`).join("\n\n")}

Use this history. Characters know what they learned in earlier episodes. Open threads (anything set up but not resolved above) should be honored, advanced, or paid off. Do NOT contradict what's been established.`;

  // Per-episode arc digest — collapses the season-wide arc pool into
  // "what matters for THIS episode" so the model gets concrete
  // imperatives (per-type modifiers + hard moments anchored here)
  // rather than wading through the full season catalog in the bible.
  // The `idx` from sorted episode list is also the 0-based episode
  // index the digest expects.
  const arcDigest = digestArcsForEpisode(story, [], idx);
  const arcBlock = formatArcDigest(arcDigest);

  return `

## Episode context (HIGH PRIORITY)
${position}

You are writing for: **Episode ${me.number}${me.title?.trim() ? ` — ${me.title.trim()}` : ""}**
Logline (this episode): ${me.logline?.trim() || "(no logline yet — infer from the season arc and prior episodes)"}
${archetype ? `\n${archetype}\n` : ""}${arcBlock}${previouslyOn}`;
}

function buildAsk(story: Story, action: ActionRequest): string {
  const c  = getActiveConceptDraft(story);
  const sl = getActiveStoryLayerDraft(story);
  // Compatibility shim so existing switch cases compile with minimal change:
  const d = { ...c, ...sl };
  switch (action.type) {
    case "generate_beats": {
      const isTV = story.projectType === "tv-show";
      const tvCtx = tvEpisodeContext(story, action.payload?.episodeId);
      const seriesType = c.settings.seriesType;
      // Episode-ending rule, type-shifted. Episodic gets the contained-
      // ending guidance; everything else gets the standard momentum
      // rule. SYSTEM_BRAIN carries the universal version; we reinforce
      // here because the final-beat property is the single most
      // important quality gate for an episodic beat sheet.
      const endingRule = isTV && tvCtx
        ? (seriesType === "episodic"
          ? `\n- This is an Episodic series. The FINAL beat should resolve THIS episode's contained A-story (case / problem / situation of the week) cleanly. A satisfying contained ending + a small character note IS the correct landing — do not force a cliffhanger.`
          : `\n- The FINAL beat must end on narrative momentum into the next episode (see TV-specific principle in system instructions). Do not let the episode "stop" — it must hand off energy to the next one.`)
        : "";
      // Hybrid clarification: the A-story IS contained, but at least
      // one serialized arc must advance somewhere in the beat sheet.
      const hybridRule = isTV && seriesType === "hybrid"
        ? `\n- This is a Hybrid series. Beats must do TWO things: (1) introduce + escalate + resolve a contained A-story (the week's case / problem / situation), AND (2) advance at least one serialized arc by a meaningful beat. Even when the A-story resolves cleanly, a serialized thread should escalate or open a question by episode end.`
        : "";
      // Arc-active rule. Every arc surfaced in the per-episode digest
      // (inside tvCtx) above intensity threshold must touch at least
      // one beat. Hard moments are non-negotiable.
      const arcRule = isTV && tvCtx
        ? `\n- Every active arc in the episode's "Active arcs this episode" block above must touch at least one beat — DOMINANT arcs anchor 1–2 beats, "active" arcs at least 1. Any "Hard moments" listed must land in a beat (not just be referenced).`
        : "";
      return `Generate a complete beat sheet for this project${d.settings.framework ? ` using the ${d.settings.framework} framework` : `, choosing whichever structural framework best fits the concept, genre, and tone`}.

Return STRICT JSON in this exact schema:
{ "beats": [ { "name": string, "summary": string, "purpose": string } ] }

Rules:
- Use every locked ingredient meaningfully.
- Weave in at least one snippet where it fits naturally (reference by title in the purpose field).
- Match the darkness/pace/unpredictability levels.
- Respect the ending types: "${d.settings.endingTypes?.join(", ") || "any"}".${arcRule}${hybridRule}${endingRule}${shortFilmGuidance(story)}${tvCtx}${directionBlock(story)}`;
    }

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
      if (!beat) {
        return `Unknown beat #${idx + 1}.`;
      }

      // Resolve per-scene cast (Beat.characterIds → Character objects)
      // and per-scene linked ideas (Beat.momentIds → Snippet objects)
      // from the active drafts. Both are intentionally re-stated in the
      // ask block (not just the bible) so the screenwriter can't miss
      // them: the bible is "everything true about the project", the ask
      // is "your specific job for this scene".
      const chDraft = getActiveCharactersDraft(story);
      const sceneCast = (beat.characterIds ?? [])
        .map(id => chDraft.characters.find(c => c.id === id))
        .filter(Boolean) as Character[];
      const linkedMoments = (beat.momentIds ?? [])
        .map(id => d.snippets.find(s => s.id === id))
        .filter(Boolean) as Snippet[];

      const dials: string[] = [];
      if (typeof beat.twist === "number") {
        dials.push(`- Twist: ${beat.twist}/10 — how surprising the reveal/turn should land in this specific scene`);
      }
      if (typeof beat.weirdness === "number") {
        dials.push(`- Weirdness: ${beat.weirdness}/10 — how strange the tone/imagery can run in this specific scene`);
      }
      const dialsBlock = dials.length
        ? `\n\nPer-scene tone dials (override the project defaults for this scene only):\n${dials.join("\n")}`
        : "";

      const castBlock = sceneCast.length
        ? `\n\nCharacters present in this scene:\n${sceneCast.map(c => {
            const bits: string[] = [];
            if (c.archetype) bits.push(c.archetype);
            if (c.want) bits.push(`wants: ${c.want}`);
            if (c.voice) bits.push(`voice: ${c.voice}`);
            return `- ${c.name}${bits.length ? ` — ${bits.join("; ")}` : ""}`;
          }).join("\n")}`
        : "";

      const linkedBlock = linkedMoments.length
        ? `\n\nIdeas the user explicitly linked to THIS scene — weave them in, do not drop them:\n${linkedMoments.map(m => {
            const tags = m.tags?.length ? ` [${m.tags.join(", ").toLowerCase()}]` : "";
            return `- ${m.title}${tags}\n  "${m.content}"`;
          }).join("\n")}`
        : "";

      // TV final-scene momentum rule. When the user generates the
      // scene for the LAST beat of an episode, this scene IS the
      // episode finale — and per the universal TV-momentum principle
      // (see SYSTEM_BRAIN) it must hand off energy to the next
      // episode. Reinforced inline so the model doesn't only see the
      // rule at system level; the inline reminder fires exactly where
      // it matters most.
      const isFinalBeat = idx === d.beats.length - 1;
      const finalSceneNote = (story.projectType === "tv-show" && isFinalBeat)
        ? `\n\nFINAL SCENE OF THIS EPISODE — momentum rule applies. This scene closes the episode. It must NOT simply stop the story. The closing image, line, or action must carry unresolved energy: an escalation of an active season arc, a reveal that reframes what came before, a deepened character conflict, or an emotionally/dramatically charged question left open. The audience should turn off the episode wanting the next one. A quiet ending is permitted only if the quietness itself contains the charge.`
        : "";

      return `Write the full scene for beat #${idx + 1}: "${beat.name}".

Beat summary: ${beat.summary}${beat.purpose ? `\nBeat purpose (what this scene does for the audience): ${beat.purpose}` : ""}${dialsBlock}${castBlock}${linkedBlock}${finalSceneNote}

Honor the project bible above — vibe "${d.settings.vibe}", genres "${d.settings.genres?.join(", ") || "drama"}", tone, themes, framework, writer voices, and reference titles all apply. The cast block above is who is on screen; characters not listed there should not appear unless the beat clearly requires it.

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

    // Whole-character single-add. Returns ONE complete new character
    // appended to the project's roster — distinct from
    // sync_concept_to_characters (regenerates the entire layer) and
    // the per-field generators (operate on an existing character).
    // The model gets the project bible above plus the existing roster
    // so the new character feels relevant to the story and doesn't
    // duplicate an existing archetype / role.
    case "generate_character": {
      const ch = getActiveCharactersDraft(story);
      const existing = ch.characters
        .map(c => `- ${c.name || "(unnamed)"} [${c.role}]${c.archetype ? ` — ${c.archetype}` : ""}`)
        .join("\n") || "(none yet)";
      return `Generate ONE new character for this project. Use the full project bible above (format, genre, logline, summary, tone, themes, ending, existing beats) so the character feels relevant to the story being told. Do not duplicate an existing archetype or role — fill a clear narrative gap.

## Existing characters in this project
${existing}

## Required output
Return STRICT JSON matching this shape exactly:
{
  "name": string,           // given + optional last name; fits genre + period
  "role": "protagonist" | "antagonist" | "supporting" | "mentor" | "love_interest" | "comic_relief",
  "archetype": string,      // 1-4 words, e.g. "reluctant mentor"
  "backstory": string,      // 2-3 sentences of history that inform who they are now
  "motivations": string,    // 1-2 sentences on what drives them
  "flaws": string,          // 1-2 sentences naming 1-2 genuine flaws
  "want": string,           // external concrete objective, 1 sentence
  "need": string,           // internal truth they must learn, 1 sentence (often in tension with want)
  "voice": string,          // 1-2 sentences on cadence / diction / verbal tics
  "arc": string,            // 1-3 sentences mapping start → end
  "notes": string           // optional supplementary detail (physicality, iconic object). Can be empty string.
}

Pick the role that best fills an obvious gap in the roster — if the roster already has a protagonist and antagonist, lean toward supporting / mentor / love_interest / comic_relief based on what the story needs. Avoid duplicating archetypes already present. Keep field tone consistent with the project bible.`;
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

    case "generate_concept_tagline":
      return `Write ONE tagline for this project — a short, punchy compression of the logline above. STRICT CONSTRAINT: 120 characters or fewer including spaces and punctuation. Single sentence, no period if it would push past 120. Sentence-case is fine; the UI uppercases it on display.
Use the existing concept (format, genre, title, logline, summary, tone, themes, ending) as the brief, but reach for the logline's central tension specifically — what's the one thing this story is ABOUT. Avoid generic prestige-cinema words ("haunting", "powerful", "unforgettable"). No quote marks around the result.

Return STRICT JSON: { "tagline": string }`;

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

    // Lightweight name → gender classifier. Called on sheet-close when
    // the user didn't pick a gender themselves; the answer populates
    // Character.gender. One canonical token only; model must not offer
    // prose or caveats.
    case "detect_character_gender": {
      const ch = getActiveCharactersDraft(story);
      const charId = action.payload?.characterId;
      const target = ch.characters.find(c => c.id === charId);
      if (!target) return `Unknown character.`;
      const name = (target.name || "").trim();
      if (!name) return `No name provided.`;
      return `Classify the most likely gender of a character named "${name}" from English-language film and television.

Return STRICT JSON with exactly one of four tokens:
{ "gender": "male" | "female" | "nonbinary" | "unspecified" }

Rules:
- Use "unspecified" when the name is strongly ambiguous (e.g. "Alex", "Sam", "Jordan") or when you cannot make a confident call.
- Use "nonbinary" only when the name itself signals a deliberately non-gendered choice (rare).
- Do not infer from story context — the answer should follow from the name alone.
- Output nothing except the JSON object above.`;
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

    // ── Easy mode: expand a fresh Concept from just title + format + genre ──
    // Used by Easy mode at project creation. The story bible above already
    // contains the seeded title/projectType/genres; this prompt asks the
    // model to invent a coherent logline/summary/tone/themes/endingTypes
    // that fit. Title/projectType/genres are sovereign — model is told
    // not to emit them, and the client strips them defensively anyway.
    case "generate_full_concept": {
      const userDirection = typeof (action.payload as any)?.userDirection === "string"
        ? (action.payload as any).userDirection
        : undefined;
      return generateFullConceptPrompt(story, userDirection);
    }

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
      // ReadThroughSheet synthesizes "scene" rows from beats, using
      // beat.id as the scene id. So look up the beat by id from the
      // active story-layer draft — that's where prose actually lives.
      const sl = getActiveStoryLayerDraft(story);
      const flatBeats = sl
        ? story.projectType === "tv-show"
          ? (sl.episodes ?? []).flatMap(ep => ep.beats)
          : sl.beats
        : [];
      const beat = flatBeats.find(b => b.id === sceneId);
      if (!beat) return `Unknown scene.`;
      const scene = {
        heading: beat.name,
        content: beat.sceneContent ?? "",
      };
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

    // ── TV episode generation ──
    // The AI-variant of "Add an Episode" on the Episodes tab. The
    // client supplies an optional `userDirection` (free-text describing
    // what should happen in the episode) plus the implied position via
    // the bible above. We produce: title + logline + 5–8 seed beats.
    case "generate_episode": {
      const payload = action.payload as { userDirection?: string; episodeNumber?: number; totalPlanned?: number };
      const userDirection = (payload?.userDirection ?? "").trim();
      const epd = getActiveEpisodesDraft(story);
      const existingCount = epd?.episodes.length ?? 0;
      const nextNumber = payload?.episodeNumber ?? (existingCount + 1);
      const totalPlanned = payload?.totalPlanned;

      // Position phrase (same logic as tvEpisodeContext but inlined here
      // because this action runs BEFORE the new episode exists, so we
      // can't reuse the helper). When total is unknown, fall back to
      // "this is episode N of an as-yet-unspecified season length."
      const positionLine =
        nextNumber === 1
          ? "This is the PILOT. Front-load setup; introduce the world, central conflict, and protagonist stakes. End on a hook strong enough to demand Episode 2."
          : totalPlanned && nextNumber === totalPlanned
            ? `This is the FINALE (Episode ${nextNumber} of ${totalPlanned}). Pay off the season's arcs; don't seed new ones unless there's a clear next-season hook. The audience should feel the arc closing.`
            : totalPlanned
              ? `This is a MIDDLE episode — Episode ${nextNumber} of ${totalPlanned} planned. Escalate from the prior episodes; advance the season arc 1–2 meaningful steps; end on a turn.`
              : `This is Episode ${nextNumber} (total season length not yet specified). Treat as a middle episode unless the season arc above implies otherwise.`;

      // Previously-on (reuse the same compression logic as tvEpisodeContext).
      const prior = epd?.episodes
        ? [...epd.episodes].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
        : [];
      const compressBeats = (beats: typeof prior[number]["beats"]): string => {
        if (!beats || beats.length === 0) return "(no beats written yet)";
        const slim = beats.length <= 6
          ? beats
          : [...beats.slice(0, 4), ...beats.slice(-2)];
        return slim.map(b => `  • ${b.name}${b.summary ? ` — ${b.summary}` : ""}`).join("\n");
      };
      const previouslyOn = prior.length === 0
        ? ""
        : `

## Previously-on
${prior.map(ep => `### Episode ${ep.number} — ${ep.title?.trim() || "(untitled)"}
Logline: ${ep.logline?.trim() || "(none)"}
Beats:
${compressBeats(ep.beats)}`).join("\n\n")}

Use this history. The new episode must NOT contradict what's established here. Honor, advance, or pay off open threads as appropriate.`;

      // Per-episode arc digest at the SLOT this new episode will land
      // in. `nextNumber` is 1-indexed; digest is 0-indexed. The digest
      // gives the model the active arcs + hard moments for this slot
      // even before the episode object exists.
      const newEpisodeIdx = Math.max(0, nextNumber - 1);
      const arcDigest = digestArcsForEpisode(story, [], newEpisodeIdx);
      const arcBlock = formatArcDigest(arcDigest);

      // Final-beat "leave us hanging" rule. Reinforced here even though
      // SYSTEM_BRAIN carries the universal version — the writer told us
      // it's the single most important property of a TV episode and
      // wanted it loud at every relevant prompt boundary.
      //
      // Series-type modifier: the rule shifts for Episodic series (the
      // contained ending IS valid there) and inverts for the Limited
      // FINALE (which MUST resolve). The line we emit reflects the
      // active type so the model gets one clean instruction, not a
      // pile of caveats.
      const seriesType = c.settings.seriesType;
      const isLimitedFinale =
        seriesType === "limited" && totalPlanned && nextNumber === totalPlanned;
      let endingMomentum: string;
      if (isLimitedFinale) {
        endingMomentum = `
- This is the Limited Series FINALE. Per the series type's structural rules, the final beat must RESOLVE the central season arc — no cliffhangers, no sequel hooks, no open questions left dangling. The episode should land with a definitive sense of "this story is complete."`;
      } else if (seriesType === "episodic") {
        endingMomentum = `
- This is an Episodic series. The final beat should resolve THIS episode's contained A-story (case / problem / situation of the week) and leave the characters near their baseline. The cross-episode momentum rule is relaxed for this type — a satisfying contained ending + a small character note IS valid. Do not force a cliffhanger.`;
      } else {
        endingMomentum = `
- The FINAL beat of the episode must create narrative momentum into the next episode. Do not simply stop the story. Land on one of:
  · a change in the audience's understanding (a piece of context reframes what we just watched),
  · an escalation of a key arc (the active arcs above level up — stakes, scope, or trajectory),
  · a reveal of new information (audience learns something the protagonist may or may not know yet),
  · a deepened character conflict (an existing tension cracks open or a new one ignites),
  · an emotionally or dramatically charged question left unresolved (a cliffhanger of meaning, not just plot).${seriesType === "ongoing" || seriesType === "anthology" || seriesType === "hybrid" ? `
  Even on a finale this rule applies — the final-finale beat should leave the audience with a question that lingers past the credits.` : `
  Even on a finale this rule applies — the final-finale beat should leave the audience with a question that lingers past the credits.`}`;
      }

      return `Compose a new TV episode for this series. Position: Episode ${nextNumber}.

${positionLine}${arcBlock}${previouslyOn}

${userDirection ? `USER DIRECTION for THIS episode (high-priority guidance — follow it):
"""
${userDirection}
"""

` : ""}Return STRICT JSON in this exact schema:
{
  "title": string,                  // 1–5 words; specific, sensory, NOT a number ("The Knot" not "Episode Three")
  "logline": string,                // 1 short paragraph (2–4 sentences). What happens this episode + the emotional stakes. Plain prose, no scene numbers.
  "beats": [                        // 5–8 seed beats. Just enough for the user to feel the spine — they will fill in detail later.
    { "name": string, "summary": string, "purpose": string }
  ]
}

Rules:
- Every output element must be grounded in the project bible (concept / characters / season arc / season arcs catalog) above.
- The title must read as a real episode title (think "Pilot" / "The Big Bang" / "The Suitcase"), not a tagline.
- The logline must declare what the audience experiences this episode — not what the season will eventually be about.
- The 5–8 beats are a SEED, not a full beat sheet. Cover the spine; leave room for the user to expand.
- Active arcs in the digest above must each touch at least one beat in your output (proportional to their tier — DOMINANT arcs anchor 1–2 beats, "active" arcs at least 1).
- Hard moments anchored to this episode are NOT optional — at least one beat must contain that moment.${endingMomentum}
- No prose outside the JSON.`;
    }

    // ── Continuity check ──
    // Reads the entire season's beats + episode loglines and surfaces
    // structural / narrative issues. UI renders the result as a notes
    // panel. Findings are scoped by severity so the user can triage.
    case "check_continuity": {
      const epd = getActiveEpisodesDraft(story);
      const episodes = epd?.episodes ?? [];
      if (episodes.length === 0) {
        return `Return STRICT JSON: { "findings": [] }. This project has no episodes yet — there is nothing to check.`;
      }
      const sorted = [...episodes].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
      const episodeBlocks = sorted.map(ep => {
        const beatLines = (ep.beats ?? []).length === 0
          ? "  (no beats yet)"
          : ep.beats.map(b => `  • ${b.name}${b.summary ? `: ${b.summary}` : ""}`).join("\n");
        return `### Episode ${ep.number}${ep.title?.trim() ? ` — ${ep.title.trim()}` : ""}
Logline: ${ep.logline?.trim() || "(none)"}
Beats:
${beatLines}`;
      }).join("\n\n");

      // Series-type-aware audit guidance. The continuity check needs
      // to know what KIND of show this is so it doesn't mis-flag a
      // valid episodic ending as a stall, or mis-flag a serialized
      // open-thread as a dropped thread, etc.
      const conceptForCheck = getActiveConceptDraft(story);
      const seriesType = conceptForCheck.settings.seriesType;
      const seriesTypeHint = seriesType ? `

# Series type for this project: ${SERIES_TYPE_LABELS[seriesType]}
${SERIES_TYPE_DESCRIPTIONS[seriesType]}

Series-type-aware rules for THIS audit:
${seriesType === "limited"
  ? "- Limited series: dropped threads weigh MAX severity (high). The finale MUST resolve — flag any open question that survives the finale as high-severity 'dropped-thread'."
  : seriesType === "anthology"
    ? "- Anthology series: dropped threads within THIS season are high-severity; threads opened that imply a future season are 'wrong-type-pacing' instead (anthology seasons are self-contained)."
    : seriesType === "ongoing"
      ? "- Ongoing/Serialized: a clean-bow finale is a FAILURE MODE. Flag any finale that resolves everything with no seeds for next season as 'ending-stall' (high). Dropped threads weigh medium — some thread carry-over IS expected."
      : seriesType === "episodic"
        ? "- Episodic: the 'ending-stall' finding is RELAXED. A contained per-episode ending is correct; only flag a stall if the closing beat literally provides no satisfying resolution to the week's A-story. Cross-episode arc-pacing findings weigh lower (light cross-episode arcs are expected). Conversely, an unresolved A-story that carries multiple episodes is 'wrong-type-pacing' (it doesn't fit the type)."
        : "- Hybrid: each episode should both resolve a contained A-story AND advance a serialized arc. Flag episodes that miss one half (only A-story OR only serialized advancement) as 'wrong-type-pacing' (medium)."}
` : "";
      return `Audit the continuity of this TV series. Read every episode below in order.${seriesTypeHint}

Surface any of the following issues:

- **Contradictions**: a character knows or says something that conflicts with what was established in an earlier episode.
- **Dropped threads**: a plot setup that's never paid off, or is forgotten between episodes.
- **Under-used characters**: a major character (per the bible) who has minimal presence across episodes.
- **Pacing problems**: stretches of episodes where the season arc doesn't advance, or where the same beat repeats.
- **Tonal whiplash**: a tonal break that isn't earned (e.g. a bottle/character episode dropped into a pure-procedural run with no setup).
- **Arc execution mismatch**: an arc from the "Season arcs" block in the bible has a high intensity at episode N, but episode N's beats don't reflect that arc's emphasis. (Warning-level finding, not error — the writer plans the arc, the beats execute it; mismatches are worth flagging, not failing on.)
- **Arc pacing**: an arc's intensity jumps more than 3 levels between adjacent episodes with no precipitating event in the intervening beats. (Sudden jumps are valid for shocks; flag them so the writer confirms the jolt is intentional.)
- **Missed hard moment**: an arc has a hard moment anchored to episode N (per the "Hard moments" lines in the bible), but episode N's beats don't contain that moment.
- **Episode-ending stall**: an episode's final beat reads as a stopping point (everything resolved, no charged question, no escalation, no reveal). Per the TV-momentum principle, every episode should hand off energy to the next. NOTE: for Episodic series this rule is relaxed — see the series-type rules above.
- **Wrong-type pacing**: the season's pacing doesn't match the declared series type. E.g. an Episodic series with a 5-episode unresolved A-story, an Ongoing series with too many self-contained eps and no thread carry-over, a Limited series with sequel-hook threads in the finale, a Hybrid episode that only does the contained A-story OR only the serialized arc.

# Episodes in order
${episodeBlocks}

Return STRICT JSON:
{
  "findings": [
    {
      "severity": "high" | "medium" | "low",
      "kind": "contradiction" | "dropped-thread" | "under-used-character" | "pacing" | "tonal-whiplash" | "arc-execution" | "arc-pacing" | "missed-hard-moment" | "ending-stall" | "wrong-type-pacing" | "other",
      "episodes": [number, …],     // which episode numbers this finding spans (1–N)
      "title": string,             // <= 60 chars, headline-style
      "detail": string             // 1–3 sentences explaining the issue concretely
    }
  ]
}

Rules:
- High-severity = a logical contradiction, dropped-thread, missed hard moment, or ending stall that breaks story trust. Surface these first.
- Medium = arc-execution / arc-pacing / under-used-character — worth flagging so the writer can confirm intent.
- Low = pacing / tonal-whiplash that might be deliberate.
- Don't pad. If nothing is wrong, return { "findings": [] }.
- No prose outside the JSON.`;
    }

    // ── TV-only "Upload Script → build the show" pipeline ─────────────
    //
    // Five sequential prompts that take an uploaded script + free-text
    // notes (either or both — the user provides one) and populate the
    // entire project: concept fields → characters → season arcs (incl.
    // 3-5 character arcs for the most important characters) → ALL N
    // episodes (title + logline + seed beats) → FULL pilot screenplay.
    //
    // Each step reads `payload.scriptText` (the uploaded source) and
    // `payload.notes` (the user's free-text additional info). The story
    // bible carries each previous step's output forward, so step 5 sees
    // concept + characters + arcs + episodes; step 4 sees concept +
    // characters + arcs; etc.
    //
    // The pilot's tone instruction is explicit: impactful, raw, and a
    // setup for the rest of the season — per the user's product brief.
    case "tv_import_concept": {
      const p = action.payload as { scriptText?: string; notes?: string };
      const concept = c.concept;
      const filled = {
        logline: !!c.logline?.trim(),
        summary: !!concept.summary?.trim(),
        themes: (concept.themes?.length ?? 0) > 0,
        framework: !!c.settings.framework,
      };
      return `Build the Concept layer of a TV series from the source material below. The project already has some Concept fields filled in — those MUST NOT be overwritten. Only propose values for fields marked "needs filling."

# Source material
${p.scriptText ? `## Uploaded script / treatment / notes\n${p.scriptText}\n` : "(no script uploaded)"}
${p.notes?.trim() ? `\n## Additional information from the writer\n${p.notes.trim()}\n` : "(no extra notes)"}

# Currently filled Concept fields (DO NOT propose values for these — return null instead)
- logline: ${filled.logline ? "(filled — leave null)" : "needs filling"}
- summary: ${filled.summary ? "(filled — leave null)" : "needs filling"}
- themes:  ${filled.themes  ? "(filled — leave null)" : "needs filling"}
- framework: ${filled.framework ? `(filled with "${c.settings.framework}" — leave null)` : "needs filling"}

Return STRICT JSON in this exact schema:
{
  "logline": string | null,
  "summary": string | null,
  "themes": string[] | null,
  "framework": "Save the Cat" | "Hero's Journey" | "Three-Act" | "Story Circle" | null
}

Rules:
- Return null for any field already filled (per the list above) — you MUST NOT propose a value.
- Return null for any field where the source material doesn't give you enough information to propose confidently.
- Logline: 2-3 sentences, present-tense, names the protagonist + central tension + stakes.
- Summary: a 1-paragraph series premise (4-6 sentences) — what the show IS, not just plot.
- Themes: 3-5 short noun phrases. No clichés.
- Framework: pick the one that best fits the SHAPE of the season, not the genre.
- No prose outside the JSON.`;
    }

    case "tv_import_characters": {
      const p = action.payload as { scriptText?: string; notes?: string; testMode?: boolean };
      const isTest = p.testMode === true;
      return `Build the full Characters roster for this TV series from the source material below + the Concept already in the project bible above.${isTest ? "\n\n**TEST MODE — return EXACTLY 2 characters.** Pick the two most important (the protagonist plus the strongest antagonist or co-lead). This is a smoke test, not a production run." : ""}

# Source material
${p.scriptText ? `## Uploaded script / treatment / notes\n${p.scriptText}\n` : "(no script uploaded)"}
${p.notes?.trim() ? `\n## Additional information from the writer\n${p.notes.trim()}\n` : "(no extra notes)"}

Return STRICT JSON in this exact schema:
{
  "characters": [
    {
      "name": string,
      "role": "protagonist" | "antagonist" | "supporting" | "mentor" | "love_interest" | "comic_relief",
      "archetype": string,          // 2-4 word genre label, e.g. "reluctant hero", "shadow mentor"
      "gender": "male" | "female" | "nonbinary" | "unspecified" | "",
      "age": string,                // numeric, range, or descriptive ("late 30s")
      "backstory": string,          // 2-4 sentences of history before episode 1
      "motivations": string,        // 1-2 sentences of what drives them
      "flaws": string,              // 1-2 sentences of where they break
      "want": string,               // the conscious goal — 1 sentence
      "need": string,               // the unconscious need — 1 sentence
      "voice": string,              // dialogue voice in 1 sentence ("clipped, deflects with humor")
      "arc": string,                // 1-2 sentence freeform character-arc summary (legacy field — structured arcs come next step)
      "notes": string               // anything else worth knowing — 0-2 sentences
    }
  ]
}

Rules:
- Include EVERY character with a meaningful presence in the source. Minor characters get tighter entries; major characters get the full treatment.
- Order: protagonist(s) FIRST, antagonist(s) next, supporting after — the order matters for downstream steps that ask for "top N" characters.
- The Concept tab above defines tone / themes / genre — character archetypes and voices must align with those.
- No prose outside the JSON.`;
    }

    case "tv_import_arcs": {
      const p = action.payload as { scriptText?: string; notes?: string; episodeCount?: number; testMode?: boolean };
      const epCount = Math.max(1, Math.min(30, Number(p.episodeCount) || 8));
      const isTest = p.testMode === true;
      return `Build the Season Arcs layer for this TV series from the source material + the Concept and Characters already in the project bible above.${isTest ? "\n\n**TEST MODE — return EXACTLY 2 arcs.** One main-plot arc that spans the season, plus one character arc for the protagonist. Skip subplots, thematic arcs, mystery arcs, and additional character arcs for this run." : ""}

# Source material
${p.scriptText ? `## Uploaded script / treatment / notes\n${p.scriptText}\n` : "(no script uploaded)"}
${p.notes?.trim() ? `\n## Additional information from the writer\n${p.notes.trim()}\n` : "(no extra notes)"}

# Target season length
${epCount} episodes

Return STRICT JSON in this exact schema:
{
  "arcs": [
    {
      "type": "main-plot" | "character" | "relationship" | "subplot" | "secrecy" | "investigation" | "mystery-reveal" | "antagonist" | "world" | "theme" | "power" | "moral-descent" | "redemption" | "rise" | "fall" | "survival" | "revenge" | "love-romance" | "family" | "identity",
      "title": string,                  // short, evocative (e.g. "Walt's Descent")
      "description": string,            // 1-2 sentences
      "scores": number[],               // EXACTLY ${epCount} entries, each integer 1-10, intensity per episode
      "characterName": string | null    // only for type=character — must match one of the character names in the bible
    }
  ]
}

Rules:
${isTest
  ? `- Return EXACTLY 2 arcs total — one main-plot arc spanning the season, plus one character arc for the protagonist.
- The character arc's characterName must match a name in the project bible's Characters list exactly.
- No subplot, theme, mystery, or additional character arcs in test mode.`
  : `- Include ONE main-plot arc that spans the whole season.
- Include 1-2 subplot arcs and 1 thematic arc (type=theme).
- Include a mystery-reveal or world arc if the genre supports it.
- ALSO INCLUDE 3-5 character arcs — pick the TOP 3-5 most important characters by their emphasis in the source material (regardless of declared role tag). For each, characterName must match a name in the project bible's Characters list exactly.`}
- Each arc's scores array must be exactly ${epCount} integers in [1, 10]. Use the score to show the arc's prominence at that episode — 1=quiet/background, 10=dominant.
- Honor the series-type structural rules in the bible — limited series arcs land on the finale; ongoing-series arcs leave seeds.
- No prose outside the JSON.`;
    }

    case "tv_import_episodes": {
      const p = action.payload as { scriptText?: string; notes?: string; episodeCount?: number; testMode?: boolean };
      const epCount = Math.max(1, Math.min(30, Number(p.episodeCount) || 8));
      const isTest = p.testMode === true;
      // Episode containers only — title, logline, archetype. NO beats.
      // Beats for the pilot get generated in the next step (tv_import_pilot)
      // alongside the screenplay. Beats for episodes 2..N stay empty and
      // get generated lazily later (per-episode, on demand) so this single
      // bulk call doesn't blow past the output-token cap on long seasons.
      return `Build the FULL slate of episode CONTAINERS for this TV series — title, logline, and archetype for every episode from pilot through finale. Do NOT generate beats; those come in later steps.${isTest ? "\n\n**TEST MODE — this is a 2-episode smoke test.** Treat Episode 1 as the pilot and Episode 2 as a compact finale that resolves whatever the pilot opened." : ""}

# Source material
${p.scriptText ? `## Uploaded script / treatment / notes\n${p.scriptText}\n` : "(no script uploaded)"}
${p.notes?.trim() ? `\n## Additional information from the writer\n${p.notes.trim()}\n` : "(no extra notes)"}

# Target season length
${epCount} episodes

Return STRICT JSON in this exact schema:
{
  "episodes": [
    {
      "number": number,             // 1..${epCount}, in order
      "title": string,              // 1-5 words; specific, sensory, NOT a generic episode number
      "logline": string,            // 2-4 sentences. What happens this episode + the emotional stakes
      "archetype": "pilot" | "case-of-the-week" | "myth-arc" | "character-focus" | "two-hander" | "bottle" | "flashback" | "finale" | "premiere" | null
    }
  ]
}

Rules:
- Return EXACTLY ${epCount} episodes, numbered 1..${epCount}, in chronological order.
- Pilot (Episode 1): introduce world + protagonist + central conflict; the logline should signal a hook strong enough to demand Episode 2.
- Finale (Episode ${epCount}): per the series-type structural rules in the bible — Limited resolves; Ongoing/Anthology/Hybrid leaves seeds; Episodic returns to baseline. The logline reflects that posture.
- Middle episodes: each logline should signal where in the season's arc escalation this episode sits — the per-episode arc intensity in the bible's "Season arcs" block tells you which arcs dominate when.
- Each episode's logline should hint at which active arcs the episode will hit, even though you are NOT writing the beats here.
- Do NOT include a "beats" field. We only want episode containers.
- No prose outside the JSON.`;
    }

    case "tv_import_pilot": {
      const p = action.payload as { scriptText?: string; notes?: string; testMode?: boolean };
      const isTest = p.testMode === true;
      const beatCountLabel = isTest ? "EXACTLY 2 beats" : "5-8 beats";
      // Pull the pilot from the episodes draft (set by step 4). The pilot
      // is the first episode (sorted by number). The pilot has NO beats
      // yet — step 4 only set up containers — so this prompt generates
      // both the pilot's beat sheet AND a screenplay scene per beat in
      // a single call.
      const epd = getActiveEpisodesDraft(story);
      const pilot = epd?.episodes
        ? [...epd.episodes].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[0]
        : null;
      const pilotContext = pilot
        ? `Episode 1 — "${pilot.title || "(untitled)"}"\nLogline: ${pilot.logline || "(none — infer from the bible above)"}`
        : "(no pilot container found — use the bible to invent a pilot title + logline before generating beats and scenes)";
      return `Write the FULL PILOT for this TV series — both the beat sheet AND the screenplay prose.${isTest ? "\n\n**TEST MODE — this is a 2-beat / 2-scene smoke test.** Keep it tight: one cold-open beat, one closing beat. Each scene short (50-150 words). Just enough to verify the pipeline works end-to-end." : ""}

This is the most important episode in the season — the first impression. It must be:
- IMPACTFUL — the cold open hooks immediately; the closing image refuses to be forgotten.
- RAW — honest emotional tone. No clichéd setups, no on-the-nose exposition, no easy answers.
- SETUP-HEAVY — plants seeds for every active season arc in the bible. The pilot's job is to make Episode 2 feel necessary.

# Source material
${p.scriptText ? `## Uploaded script / treatment / notes (use as ground truth — if this IS the actual pilot script, extract its scenes near-verbatim; if it's a treatment, adapt it into screenplay form)\n${p.scriptText}\n` : "(no script uploaded — generate from scratch using the project bible + notes)"}
${p.notes?.trim() ? `\n## Additional information from the writer\n${p.notes.trim()}\n` : ""}

# Pilot container (from the previous step — title + logline established; beats are NOT yet written, you will generate them now)
${pilotContext}

Return STRICT JSON in this exact schema:
{
  "beats": [
    {
      "name": string,         // 1-5 word beat label, sensory + specific
      "summary": string,      // 1-2 sentences. What happens in this beat.
      "purpose": string       // 1 sentence. What this beat does for the audience.
    }
  ],
  "scenes": [
    {
      "beatIndex": number,    // 0-based index into the beats array above — exactly one scene per beat in order
      "heading": string,      // standard screenplay slug, e.g. "INT. KITCHEN - NIGHT"
      "content": string       // the actual screenplay prose for this scene
    }
  ]
}

CRITICAL OUTPUT REQUIREMENT:
- The "beats" array MUST contain at least one entry.
- The "scenes" array MUST contain at least one entry.
- An empty array for either is an error and breaks the downstream pipeline. If you have any reason to refuse part of this task, return a valid minimal example rather than an empty array.

Beat-writing rules:
- Produce ${beatCountLabel} total.
- Beats trace the pilot's narrative arc from cold open through the closing image — setup → escalation → turn → button.
- Every active season arc in the bible's "Season arcs" block should get touched by at least one beat. Dominant arcs anchor 1-2 beats.

Scene-writing rules:
- Exactly one scene per beat, in order. The scenes array length === the beats array length.
- Real screenplay format: slugline, action lines, character names ALL CAPS above their dialogue, dialogue blocks.
- No scene-number prefixes (no "1.", no "SCENE 1") — just the slugline.
- Action is present-tense, visual, sensory. Avoid "we see" / "we hear" — show the image.
- Dialogue is the character's voice as defined in the bible. Distinct rhythms per character.
- Each scene has a DECISION or REVELATION inside it — no idle "people talk about exposition" filler.
- The first scene is a true COLD OPEN — drop us in mid-tension, no establishing throat-clearing.
- The final scene of the pilot per the TV-momentum principle: closing image / line / action MUST carry unresolved energy. The audience should HAVE to watch Episode 2.
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
    // Pick the next episode that has zero beats — that's the one the user
    // is implicitly asking us to plan. Falls back to the last episode when
    // every existing one is already populated, so the AI still has a clear
    // target rather than dumping into an arbitrary slot.
    //
    // Now sources from the canonical `episodesDrafts` location (not the
    // deprecated `storyLayer.episodes`) and threads the same
    // `tvEpisodeContext` block used by `generate_beats` so the prompt
    // carries position (pilot/middle/finale), archetype, and a
    // previously-on summary of prior episodes' beats.
    const epd = getActiveEpisodesDraft(story);
    const allEpisodes = epd?.episodes ?? [];
    const targetEpisode =
      allEpisodes.find(ep => ep.beats.length === 0) ??
      allEpisodes[allEpisodes.length - 1];
    const targetLabel = targetEpisode
      ? `Episode ${targetEpisode.number}${targetEpisode.title?.trim() ? ` ("${targetEpisode.title.trim()}")` : ""}`
      : "the next episode";
    return `Derive a beat sheet for ${targetLabel} of this TV series from the ${sourceLabel(source)} above${sourceBlock ? ", ensuring cohesion with every other layer that already exists (see blocks below)" : ""}.${sourceBlock}

${source === "script"
  ? "Extract the beat structure implicit in the scene prose."
  : framework
    ? `Use the ${framework} framework.`
    : "Choose whichever structural framework best fits the concept and genre, and apply it consistently."} Return one episode's worth of beats — for ${targetLabel} specifically.

Return STRICT JSON:
{
  "beats": [
    { "name": string, "summary": string, "purpose": string }
  ]
}

Rules:
- 8–15 beats.
- Each "summary" is 1–2 sentences; each "purpose" is 1 sentence naming what the beat does for the audience.
- No prose outside the JSON.${tvEpisodeContext(story, targetEpisode?.id)}${directionBlock(story)}`;
  }

  // Short-film path: ignore the feature-style framework field (for shorts
  // we let `shortStructure` drive flavor and `duration` drive count). The
  // framework picker is still rendered for shorts as a soft fallback, but
  // the shortFilmGuidance block is the primary lever.
  if (story.projectType === "short") {
    const settings = getActiveConceptDraft(story).settings;
    const { low, high } = shortSceneCount(settings.duration);
    return `Derive the Story layer (beat sheet) from the ${sourceLabel(source)} above${sourceBlock ? ", ensuring cohesion with every other layer that already exists (see blocks below)" : ""}.${sourceBlock}

${source === "script"
  ? "Extract the beat structure implicit in the scene prose — one beat per narrative turn, not per scene."
  : "Build a beat sheet sized for a short film — see the short-film guidance below."}

Return STRICT JSON:
{
  "beats": [
    { "name": string, "summary": string, "purpose": string }
  ]
}

Rules:
- Produce ${low}–${high} beats — one per scene the screenplay will end up with.
- Each "summary" is 1–2 sentences; each "purpose" is 1 sentence naming what the beat does for the audience.
- No prose outside the JSON.${shortFilmGuidance(story)}${directionBlock(story)}`;
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
- No prose outside the JSON.${directionBlock(story)}`;
}

function syncPrompt_toScript(story: Story, source: "concept" | "characters" | "story"): string {
  const c = getActiveConceptDraft(story);
  const genres = c.settings.genres?.join(", ") || "drama";
  const writerStyles = c.settings.writerStyles?.length
    ? c.settings.writerStyles.join(", ")
    : "";
  const references = c.settings.references?.length
    ? c.settings.references.map(r => `"${r.title}"${r.aspects?.length ? ` (${r.aspects.join(", ")})` : ""}`).join("; ")
    : "";
  const styleBlock =
    writerStyles || references
      ? `\n\nVoice and tonal targets (already in the bible — restated here so they actually shape the prose):${writerStyles ? `\n- Writer voices to echo: ${writerStyles}` : ""}${references ? `\n- References to mirror: ${references}` : ""}`
      : "";
  const isShort = story.projectType === "short";
  const isTV = story.projectType === "tv-show";
  // Short scene count comes from duration when set (≈ 1 scene per 1.5 min,
  // clamped 6–12); when unset we fall back to the legacy "6–10 scenes"
  // label so the model has a range to aim at instead of an exact integer.
  const shortScenes = isShort && c.settings.duration
    ? shortSceneCount(c.settings.duration).label
    : "6–10 scenes";
  const targetScenes =
    source === "story"
      ? "one scene per beat in the beat sheet above"
      : isShort
      ? shortScenes
      : "14–22 scenes";
  // For TV, identify which episode this script run targets — same logic as
  // syncPrompt_toStory: the first empty episode (next to write), or the
  // last one if every episode already has beats. The label gets spliced
  // into the lead sentence so the model commits prose to the right episode.
  let tvEpisodeLabel = "pilot-episode";
  let tvContinuityNote = "";
  if (isTV) {
    const sl = getActiveStoryLayerDraft(story);
    const allEpisodes = sl.episodes ?? [];
    const target =
      allEpisodes.find(ep => ep.beats.length > 0 && !ep.beats.some(b => b.status === "written")) ??
      allEpisodes.find(ep => ep.beats.length === 0) ??
      allEpisodes[allEpisodes.length - 1];
    if (target) {
      tvEpisodeLabel = `Episode ${target.number} ("${target.title}")`;
      const priorWritten = allEpisodes.filter(ep => ep.number < target.number && ep.beats.some(b => b.status === "written")).length;
      if (priorWritten > 0) {
        tvContinuityNote = ` ${priorWritten === 1 ? "One prior episode has" : `${priorWritten} prior episodes have`} already been written and ${priorWritten === 1 ? "is" : "are"} canon — keep this episode consistent with the established voice, character behavior, and continuity shown in the bible above.`;
      }
    }
  }
  // When generating a fresh script but a prior script already exists,
  // include the prior prose as tonal/character reference so the new
  // draft feels cohesive with what the user has seen.
  const existingProse = scriptProseBlock(story);
  const priorScriptBlock =
    existingProse && existingProse !== "(no scenes)"
      ? `\n\n## Prior script prose (for tonal reference only)\nA prior version of this script exists. Treat it as reference for the project's voice, characters, and tone. You are writing a fresh take driven by the ${sourceLabel(source)} — feel free to restructure — but keep character names and established tone consistent.\n\n${existingProse}`
      : "";

  return `Write a complete ${isShort ? "short-film" : isTV ? tvEpisodeLabel : "feature-length"} screenplay driven by the ${sourceLabel(source)} above.${tvContinuityNote}

Produce ${targetScenes}. Match the genres "${genres}" and the tone on the brief.${styleBlock}

${source === "story" ? "Each beat in the bible above carries its own per-scene dials (Twist / Weirdness), cast list, and linked ideas. Honor them per-scene — those instructions override the project defaults for that one scene only. Linked ideas listed under a beat MUST appear in that beat's prose." : "No beat sheet has been written yet, so synthesize coherent scene structure as you go. The user will back-fill the Story layer separately."}${priorScriptBlock}

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

No prose outside the JSON.${shortFilmGuidance(story)}`;
}

function syncPrompt_toConcept(story: Story, source: "characters" | "story" | "script"): string {
  const sourceBlock = cohesionScriptBlock(story, source);
  return `Derive a refreshed Concept layer from the ${sourceLabel(source)} above${sourceBlock ? ", ensuring cohesion with every other layer that already exists (see blocks below)" : ""}.${sourceBlock}

The project's **title, format, genres, duration, and short-structure type are fixed** — the user chose these explicitly and they are NOT to be reconsidered. Do not include them in the output.

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

// Easy mode: invent a coherent Concept layer from just the seeded
// title + format + genres. The storyBible above already exposes those
// three fields. We ask the model to fill the *remaining* concept fields
// (logline, summary, tone, themes, endingTypes) and to leave title /
// format / genres alone — those are sovereign once the user picked them.
function generateFullConceptPrompt(story: Story, userDirection?: string): string {
  const projectTypeLabel =
    story.projectType === "tv-show" ? "TV show"
      : story.projectType === "short" ? "short film"
      : "feature film";
  // For shorts, nudge Sonnet toward a concept that fits the runtime so
  // downstream Story/Script generation isn't trying to compress a feature
  // arc into 6–12 scenes.
  const shortRuntimeHint = story.projectType === "short"
    ? `\n\nThis is a short film. Target runtime ~${getActiveConceptDraft(story).settings.duration ?? 12} minutes — the concept must fit a short-film scope (one focused idea, turning point, or contradiction) rather than a feature arc.`
    : "";
  // User-supplied direction collected on the Easy-mode direction
  // sheet (free-text guidance + bullet list of selected ideas).
  // Spliced in BEFORE the field-by-field rules so it influences
  // every generated value, not just one.
  const directionBlock = userDirection?.trim()
    ? `\n\n## User direction\n${userDirection.trim()}\n\nLean on this guidance heavily — the user's intent should shape the logline, summary, tone, themes, and ending choice. Translate vague phrasing into specific, sensory choices; don't just rephrase the user's words back at them.`
    : "";
  return `You are kicking off a new ${projectTypeLabel} project. The user has provided ONLY the title, format, and genres above — every other concept field is empty. Invent a coherent Concept layer that an experienced screenwriter would happily build the rest of the project on.

The project's **title, format, and genres are fixed** — the user chose these at creation. Do NOT reconsider them and do NOT include them in your output.${shortRuntimeHint}${directionBlock}

Each field:
- logline: 1–2 sentences, ≤40 words. Protagonist + inciting event + goal + conflict + stakes. Must read like a real logline a working writer would pitch.
- summary: 3–5 sentences, ~80 words. World → protagonist → inciting event → central tension → thematic undertow. Specific, sensory, not generic.
- tone: short evocative phrase (2–6 words), e.g. "bone-dry deadpan", "neon-lit dread".
- themes: 3–5 punchy noun phrases (1–3 words each).
- endingTypes: 1 or 2 entries from: "happy" | "bittersweet" | "tragic" | "ambiguous" | "twist" — whichever best fits the genre + tone you settled on.

Stay faithful to the genres listed above. If multiple genres are set, blend them naturally rather than picking one.

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
