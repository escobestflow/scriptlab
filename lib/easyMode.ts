// Easy-mode project creation: chain AI calls to populate every layer
// (Concept → Characters → Story → first Script scene) from a freshly-
// seeded Story whose only filled fields are title + format + genres.
// Each step's result is persisted to Supabase before the next step
// runs, so a crash mid-chain leaves the user with recoverable partial
// state rather than nothing.
//
// Step 4 only writes the FIRST scene — once it lands the caller
// (app/page.tsx) navigates the user to the Script tab and kicks off a
// background loop (lib/scriptLoop.ts) to drain the rest. This keeps
// the loader blocking-time short (~30s for steps 1–3 + scene 1 instead
// of several minutes for all scenes) so users don't quit mid-run.
//
// Why this exists in addition to lib/syncLayer.ts:
//   - syncLayer is the right primitive for steps 2 and 3. It POSTs to
//     /api/generate, parses, and writes the result to the next active
//     draft. Each call sends the *full* story, so passing the evolving
//     story between calls means each step's prompt sees the prior
//     step's output as upstream context.
//   - syncLayers (the multi-target orchestrator) is wrong here: it
//     deliberately uses the SAME source snapshot for every target so
//     "update Characters + Story + Script from this Concept" doesn't
//     drift mid-run. Easy mode wants exactly the opposite — chaining,
//     not parallel.
//   - Step 1 (concept expansion) needs a dedicated action type
//     (generate_full_concept) because the existing sync_*_to_concept
//     types only flow INTO concept from a populated upstream layer, and
//     chaining 5 per-field generators would be 5 sequential roundtrips
//     when one Sonnet call can do it.
//   - Step 4 used to call `syncLayer(..., "story", "script")` which
//     wrote prose to scriptDraft.script.scenes[i] — but the Script tab
//     renders from beats[i].sceneContent, not from scriptDraft.scenes.
//     The result: Easy mode "completed" but the Script tab looked
//     empty. The fix is the per-beat loop in lib/scriptLoop.ts which
//     writes to the bucket the UI actually reads from.

import type { Story, LayerKey } from "./story";
import { applySyncResult } from "./story";
import type { ActionRequest } from "./prompt";
import type { WriterProfile } from "./writerProfile";
import { callGenerate, extractJson, normalizeConceptPatch, syncLayer } from "./syncLayer";
import { runScriptGenerationLoop } from "./scriptLoop";

export type EasyModeStep = "concept" | "characters" | "story" | "script";

export interface RunEasyModeCallbacks {
  /** Fires before each step's API call so the overlay can swap which
   *  row shows the in-progress spinner. */
  onStep: (step: EasyModeStep) => void;
  /** Persist the evolving Story after each step. Caller upserts both
   *  to local React state and to Supabase so a crash mid-chain leaves
   *  the partial project recoverable. Awaited so the next step can't
   *  start until the prior write has flushed. */
  persist: (next: Story) => Promise<void>;
  /** Optional writer profile passed through to /api/generate so the
   *  AI tailors output to the user's voice settings. */
  profile?: WriterProfile | null;
}

/**
 * Error thrown when any step in the chain fails. Includes the offending
 * step and the partial story (containing every successful prior write)
 * so the caller's error UI can offer Retry / "Open project anyway"
 * affordances against real state.
 */
export class EasyModeError extends Error {
  failedStep: EasyModeStep;
  partialStory: Story;
  constructor(step: EasyModeStep, partial: Story, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Easy mode failed at ${step}: ${msg}`);
    this.name = "EasyModeError";
    this.failedStep = step;
    this.partialStory = partial;
  }
}

/**
 * Step 1 of the chain — only needed because the cross-layer sync
 * actions can't expand from an empty concept. Mirrors syncLayer's
 * shape: callGenerate → extractJson → applySyncResult. The active
 * concept draft is empty at this point, so applySyncResult overwrites
 * in place rather than creating a new draft.
 */
async function expandFullConcept(
  seed: Story,
  profile?: WriterProfile | null,
): Promise<Story> {
  const action: ActionRequest = { type: "generate_full_concept", payload: {} };
  const rawText = await callGenerate(seed, action, profile);
  const parsed = extractJson(rawText);
  // normalizeConceptPatch strips title/projectType/genres defensively
  // (the prompt already asks the model to omit them).
  const patch = normalizeConceptPatch(parsed);
  return applySyncResult(seed, { kind: "concept", patch });
}

/**
 * Run the full Easy-mode pipeline against `seedStory`. Returns the
 * fully populated Story on success; throws EasyModeError on failure
 * with `failedStep` + `partialStory` set.
 *
 * Each step:
 *   1. Fires `onStep(step)` so the overlay can highlight the current row.
 *   2. Calls the AI. For step 1 this is generate_full_concept; for
 *      steps 2–4 it's syncLayer (which sends the full evolving story
 *      to the model as context, so each step sees the prior layer's
 *      output as upstream).
 *   3. Awaits `persist(next)` before returning to the caller, so a
 *      crash between steps still leaves the prior write committed.
 */
export async function runEasyMode(
  seedStory: Story,
  callbacks: RunEasyModeCallbacks,
): Promise<Story> {
  const { onStep, persist, profile } = callbacks;
  let current = seedStory;

  // Step 1: Concept (empty → populated).
  onStep("concept");
  try {
    current = await expandFullConcept(current, profile);
    await persist(current);
  } catch (e) {
    throw new EasyModeError("concept", current, e);
  }

  // Step 2: Characters from Concept.
  onStep("characters");
  try {
    current = await syncLayer(current, "concept", "characters", profile);
    await persist(current);
  } catch (e) {
    throw new EasyModeError("characters", current, e);
  }

  // Step 3: Story (beats / episodes) from Characters. Note the model
  // also sees the freshly populated concept as upstream context (the
  // prompt for sync_characters_to_story includes the full story bible).
  onStep("story");
  try {
    current = await syncLayer(current, "characters", "story", profile);
    await persist(current);
  } catch (e) {
    throw new EasyModeError("story", current, e);
  }

  // Step 4: Script from Story — but ONLY the first scene. We hand the
  // user off to the Script tab as soon as they have something to read,
  // and the caller (page.tsx) kicks off a background loop to drain the
  // remaining beats while the user reads scene 1. See lib/scriptLoop.ts
  // for the rationale and lib/easyMode.ts's history for what this used
  // to do (a single sync_story_to_script call that wrote prose to the
  // wrong storage bucket — script.scenes instead of beats[i].sceneContent
  // — so Easy mode "completed" but the Script tab looked empty).
  onStep("script");
  try {
    let scriptCurrent = current;
    let firstSceneError: Error | null = null;
    await runScriptGenerationLoop({
      initialStory: scriptCurrent,
      profile,
      maxScenes: 1,
      persist: async (next) => {
        scriptCurrent = next;
        await persist(next);
      },
      onError: (err) => { firstSceneError = err; },
    });
    if (firstSceneError) throw firstSceneError;
    current = scriptCurrent;
  } catch (e) {
    throw new EasyModeError("script", current, e);
  }

  return current;
}

/** Canonical layer order for the overlay's progress checklist. */
export const EASY_MODE_STEPS: EasyModeStep[] = ["concept", "characters", "story", "script"];

/** Map an EasyModeStep to the canonical LayerKey. They're identical
 *  strings today, but typing them separately means future product
 *  decisions (e.g. "land on Characters tab on partial failure") don't
 *  need to invent a new mapping function. */
export function stepToLayer(step: EasyModeStep): LayerKey {
  return step;
}
