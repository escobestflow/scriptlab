// Cross-layer sync orchestration.
//
// Two public entry points:
//   - syncLayer(story, source, target)     — run one source→target sync.
//   - syncLayers(story, source, targets, onStep) — run several, in canonical
//     order, against the same source snapshot. Each target's write is
//     applied to the evolving Story.
//
// Each sync:
//   1. POSTs an ActionRequest of type `sync_<source>_to_<target>` to
//      /api/generate.
//   2. Concatenates the ndjson `text` events into a single string.
//   3. Parses the string as JSON. Shape depends on target:
//        concept    → { logline?, summary?, tone?, themes?, endingTypes? }
//        characters → { characters: [...] }
//        story      → { beats: [...] } or { episodes: [...] }   (non-TV / TV)
//        script     → { scenes: [...] }
//   4. Normalizes the payload into the `LayerContent` union.
//   5. Calls `applySyncResult` in lib/story.ts, which picks overwrite-in-place
//      vs new-draft based on whether the target's active draft is empty.
//
// Protected Concept fields (`title`, `projectType`, `genres`) are stripped at
// parse time — defense-in-depth even though the prompt already asks the model
// not to include them.

import type {
  Story,
  LayerKey,
  LayerContent,
  Character,
  Beat,
  Episode,
  Scene,
  EndingType,
} from "./story";
import { applySyncResult } from "./story";
import type { ActionRequest, ActionType } from "./prompt";

// ── Canonical order ────────────────────────────────────────────────
// Sort targets by this so that when the user checks several, they run
// Concept → Characters → Story → Script (most upstream first).
const ORDER: LayerKey[] = ["concept", "characters", "story", "script"];
export function compareLayers(a: LayerKey, b: LayerKey): number {
  return ORDER.indexOf(a) - ORDER.indexOf(b);
}

// ── /api/generate call ─────────────────────────────────────────────

async function callGenerate(story: Story, action: ActionRequest): Promise<string> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ story, action }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`/api/generate ${res.status}: ${body || "(no body)"}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  let streamError: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "text") fullText += msg.value;
        else if (msg.type === "error") streamError = msg.value;
      } catch {
        /* ignore malformed line */
      }
    }
  }

  if (streamError && !fullText) {
    throw new Error(`generate stream error: ${streamError}`);
  }
  return fullText;
}

// ── JSON parsing ───────────────────────────────────────────────────
// Models return strict JSON per our prompts, but in practice sometimes
// wrap in ```json fences or add a stray trailing newline. Be lenient.

function extractJson(text: string): any {
  const trimmed = text.trim();
  // Strip code fences if present.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenced ? fenced[1] : trimmed;
  // If there's leading prose before an object, grab from the first `{`.
  const firstBrace = body.indexOf("{");
  const candidate = firstBrace > 0 ? body.slice(firstBrace) : body;
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Last resort: try to match the outermost balanced `{...}` block.
    const lastBrace = candidate.lastIndexOf("}");
    if (lastBrace > 0) {
      try { return JSON.parse(candidate.slice(0, lastBrace + 1)); }
      catch { /* fall through */ }
    }
    throw new Error(`Sync result was not valid JSON: ${(e as Error).message}`);
  }
}

// ── Payload → LayerContent normalization ───────────────────────────

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCharacter(raw: any): Character {
  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : randomId("c"),
    name:         typeof raw?.name === "string"         ? raw.name         : "",
    role:         typeof raw?.role === "string"         ? raw.role         : "",
    archetype:    typeof raw?.archetype === "string"    ? raw.archetype    : "",
    backstory:    typeof raw?.backstory === "string"    ? raw.backstory    : "",
    motivations:  typeof raw?.motivations === "string"  ? raw.motivations  : "",
    flaws:        typeof raw?.flaws === "string"        ? raw.flaws        : "",
    want:         typeof raw?.want === "string"         ? raw.want         : "",
    need:         typeof raw?.need === "string"         ? raw.need         : "",
    relationships: Array.isArray(raw?.relationships) ? raw.relationships
      .filter((r: any) => r && typeof r.characterId === "string" && typeof r.description === "string")
      .map((r: any) => ({ characterId: r.characterId, description: r.description }))
      : [],
    voice:        typeof raw?.voice === "string"        ? raw.voice        : "",
    arc:          typeof raw?.arc === "string"          ? raw.arc          : "",
    notes:        typeof raw?.notes === "string"        ? raw.notes        : "",
  };
}

function normalizeBeat(raw: any, position: number): Beat {
  return {
    id:      typeof raw?.id === "string" && raw.id ? raw.id : randomId("b"),
    name:    typeof raw?.name === "string"    ? raw.name    : "",
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    purpose: typeof raw?.purpose === "string" ? raw.purpose : "",
    position,
    momentIds: [],
    characterIds: [],
    status: "design",
  };
}

function normalizeEpisode(raw: any, idx: number): Episode {
  const rawBeats = Array.isArray(raw?.beats) ? raw.beats : [];
  return {
    id:     typeof raw?.id === "string" && raw.id ? raw.id : randomId("ep"),
    title:  typeof raw?.title === "string" ? raw.title : `Episode ${idx + 1}`,
    number: typeof raw?.number === "number" ? raw.number : idx + 1,
    beats:  rawBeats.map((b: any, i: number) => normalizeBeat(b, i)),
  };
}

function normalizeScene(raw: any): Scene {
  return {
    id:      typeof raw?.id === "string" && raw.id ? raw.id : randomId("sc"),
    beatId:  typeof raw?.beatId === "string" ? raw.beatId : null,
    heading: typeof raw?.heading === "string" ? raw.heading : "",
    content: typeof raw?.content === "string" ? raw.content : "",
    notes:   typeof raw?.notes === "string" ? raw.notes : "",
  };
}

const ALLOWED_ENDING_TYPES: ReadonlySet<EndingType> =
  new Set(["happy", "bittersweet", "tragic", "ambiguous", "twist"]);

function normalizeConceptPatch(raw: any) {
  // Strip any protected fields defensively — the prompt asks the model
  // to omit them, but don't trust.
  const patch: {
    logline?: string; summary?: string; tone?: string;
    themes?: string[]; endingTypes?: EndingType[];
  } = {};
  if (typeof raw?.logline === "string") patch.logline = raw.logline;
  if (typeof raw?.summary === "string") patch.summary = raw.summary;
  if (typeof raw?.tone === "string")    patch.tone    = raw.tone;
  if (Array.isArray(raw?.themes)) {
    patch.themes = raw.themes.filter((t: any): t is string => typeof t === "string");
  }
  if (Array.isArray(raw?.endingTypes)) {
    patch.endingTypes = raw.endingTypes
      .filter((t: any): t is EndingType => typeof t === "string" && ALLOWED_ENDING_TYPES.has(t as EndingType));
  }
  return patch;
}

function payloadToContent(
  target: LayerKey,
  raw: any,
  story: Story,
): LayerContent {
  switch (target) {
    case "concept":
      return { kind: "concept", patch: normalizeConceptPatch(raw) };
    case "characters": {
      const list = Array.isArray(raw?.characters) ? raw.characters : [];
      return { kind: "characters", characters: list.map(normalizeCharacter) };
    }
    case "story": {
      if (story.projectType === "tv-show") {
        const rawEps = Array.isArray(raw?.episodes) ? raw.episodes : [];
        return {
          kind: "story",
          beats: [],
          episodes: rawEps.map((e: any, i: number) => normalizeEpisode(e, i)),
        };
      }
      const rawBeats = Array.isArray(raw?.beats) ? raw.beats : [];
      return {
        kind: "story",
        beats: rawBeats.map((b: any, i: number) => normalizeBeat(b, i)),
      };
    }
    case "script": {
      const list = Array.isArray(raw?.scenes) ? raw.scenes : [];
      return { kind: "script", scenes: list.map(normalizeScene) };
    }
  }
}

// ── Public API ────────────────────────────────────────────────────

function actionTypeFor(source: LayerKey, target: LayerKey): ActionType {
  return `sync_${source}_to_${target}` as ActionType;
}

export async function syncLayer(
  story: Story,
  source: LayerKey,
  target: LayerKey,
): Promise<Story> {
  if (source === target) {
    throw new Error(`syncLayer: source and target must differ (got ${source})`);
  }
  const action: ActionRequest = {
    type: actionTypeFor(source, target),
    payload: {},
  };
  const rawText = await callGenerate(story, action);
  const parsed = extractJson(rawText);
  const content = payloadToContent(target, parsed, story);
  return applySyncResult(story, content);
}

/**
 * Run several targets from the same source, in canonical order. Results
 * are applied cumulatively to the evolving Story so draft numbering and
 * "empty vs non-empty" checks see the prior writes correctly.
 *
 * NOTE: the source snapshot passed to each LLM call is always the
 * original `story`, so no sync's result pollutes a later sync's source
 * context. Only the write-target state evolves.
 *
 * If any target throws, prior successful writes are preserved and the
 * error is rethrown, tagged with which target failed.
 */
export async function syncLayers(
  story: Story,
  source: LayerKey,
  targets: LayerKey[],
  onStep?: (target: LayerKey) => void,
): Promise<Story> {
  const ordered = [...targets]
    .filter(t => t !== source)
    .sort(compareLayers);

  let next = story;
  for (const target of ordered) {
    onStep?.(target);
    try {
      const action: ActionRequest = {
        type: actionTypeFor(source, target),
        payload: {},
      };
      // Always drive the LLM from the original source snapshot.
      const rawText = await callGenerate(story, action);
      const parsed = extractJson(rawText);
      const content = payloadToContent(target, parsed, next);
      // Apply to the evolving story so draft numbering stays consistent
      // if the same target somehow appears twice (defensive). Decide
      // overwrite-vs-new-draft against the ORIGINAL `story` — otherwise
      // a prior target's write (e.g. syncing to Story first) would reset
      // that layer's content and trick the next empty-check (e.g. for
      // Script, which cross-references written beats) into overwriting.
      next = applySyncResult(next, content, story);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const err = new Error(`Sync to ${target} failed: ${msg}`) as Error & {
        failedTarget?: LayerKey;
        partialStory?: Story;
      };
      err.failedTarget = target;
      err.partialStory = next;
      throw err;
    }
  }
  return next;
}
