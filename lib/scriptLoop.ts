// Per-beat script generation loop. Single source of truth for both:
//   - Easy mode (lib/easyMode.ts step 4) — runs the loop with maxScenes=1
//     so the user is held on the loader only until the FIRST scene is
//     written, then navigated to Studio.
//   - Studio's "Write all scenes with AI" button — runs the loop with
//     no cap, in the background. Spinners + persistence-per-iteration
//     mean partial completion survives a tab close.
//
// What this fixes vs. the previous sync_story_to_script flow:
//   - sync_story_to_script wrote prose to scriptDraft.script.scenes[i].
//     The Script tab renders from beats[i].sceneContent, so that data
//     was invisible to the user. Easy mode "completed" but the Script
//     tab looked empty. This loop writes to beats[i].sceneContent — the
//     bucket the UI actually reads from.
//   - The previous Studio.tsx generateAllScript loop only updated React
//     state (no Supabase write per iteration). Tab close mid-loop lost
//     every completed-but-unsaved scene. This helper persists after
//     each scene.
//
// Why the loop owns its own `current` snapshot rather than reading from
// React state on every iteration:
//   - Decouples the loop from React lifecycle. Easy mode's background
//     continuation runs in app/page.tsx scope; Studio's button runs in
//     component scope. Same helper, different lifetimes.
//   - The persist callback is the contract: callers map it to whatever
//     React state + DB write they want. The loop only cares that
//     persist resolves before the next iteration starts.
//   - Trade-off: if the user edits a beat name mid-loop, the loop
//     won't see it. Acceptable — Easy mode users aren't editing during
//     the ~30-second background run, and the manual "Generate all"
//     button has the same behavior today.

import type { Story, Beat } from "./story";
import {
  getActiveStoryLayerDraft,
  updateStoryLayerDraft,
  createNewStoryLayerDraft,
  createNewScriptDraft,
} from "./story";
import type { ActionRequest } from "./prompt";
import type { WriterProfile } from "./writerProfile";
import { callGenerate } from "./syncLayer";

export interface ScriptLoopOptions {
  /** The Story to start from. The loop's internal `current` snapshot
   *  is initialized from this and evolves with each scene write. */
  initialStory: Story;
  /** Persist the updated Story after each scene. Caller wires this to
   *  both local React state AND Supabase upsert so partial completion
   *  is durable. Awaited so the next iteration sees the prior write
   *  reflected in any caller-side derived state. */
  persist: (next: Story) => Promise<void>;
  /** Optional writer profile passed through to /api/generate. */
  profile?: WriterProfile | null;
  /** Stop after writing this many scenes. Easy mode passes 1 so it can
   *  await the first scene + navigate. Background continuation passes
   *  undefined to drain the queue. The loop filters out already-written
   *  beats first, so a second call naturally resumes where the first
   *  stopped. */
  maxScenes?: number;
  /** Fires immediately before a beat's API call starts. Caller uses
   *  this to flip the per-beat spinner state in the Script tab. */
  onBeatStart?: (beatId: string, beatIndex: number) => void;
  /** Fires after a beat's prose has been written + persisted.
   *  `isFirstDone` is true on the first onBeatDone of this run only —
   *  Easy mode's background continuation uses it for nothing today,
   *  but it gives callers a hook for first-scene-ready UX. */
  onBeatDone?: (beatId: string, beatIndex: number, isFirstDone: boolean) => void;
  /** Fires after the queue drains (or maxScenes is hit) without error. */
  onComplete?: (finalStory: Story) => void;
  /** Fires if any iteration fails. Loop stops; scenes already written
   *  in this run are persisted. partialStory is the latest known state. */
  onError?: (err: Error, beatId: string, beatIndex: number, partialStory: Story) => void;
}

/**
 * Iterate every beat that isn't yet "written" (or is "written" but has
 * empty sceneContent — defensive against partial state from older
 * codepaths) and call /api/generate with action `generate_scene` per
 * beat. The resulting prose is written to `beats[i].sceneContent` and
 * the beat's status flips to "written".
 *
 * Sequential by design: each scene's prompt sees prior scenes' prose as
 * upstream context (the prompt builder reads the current story bible),
 * so cohesion across the script comes for free. Don't parallelize this.
 *
 * Returns when the loop completes (success, hit maxScenes, or first
 * error). Caller decides whether to await or fire-and-forget.
 */
export async function runScriptGenerationLoop(opts: ScriptLoopOptions): Promise<void> {
  const {
    initialStory,
    persist,
    profile,
    maxScenes,
    onBeatStart,
    onBeatDone,
    onComplete,
    onError,
  } = opts;

  let current = initialStory;
  const sl = getActiveStoryLayerDraft(current);
  if (!sl) { onComplete?.(current); return; }

  // Flatten beats with their canonical index (TV-show projects hold
  // beats inside episodes; feature/short hold them flat). The
  // generate_scene action's payload uses `beatIndex` as the position
  // inside the flattened array, mirroring how Studio.tsx's existing
  // single-beat generator passes it.
  type QueueEntry = { id: string; index: number; name: string; status: string; sceneContent?: string };
  const allBeats: QueueEntry[] = (current.projectType === "tv-show"
    ? (sl.episodes ?? []).flatMap(ep => ep.beats)
    : sl.beats
  ).map((b, i) => ({
    id: b.id,
    index: i,
    name: b.name,
    status: b.status ?? "design",
    sceneContent: b.sceneContent,
  }));

  // Resume-friendly filter: skip beats whose prose is already written.
  // This is what makes Easy mode's "scene 1 + background scenes 2..N"
  // work as two separate calls — the second call naturally starts at
  // the first unwritten beat.
  const queue = allBeats.filter(b => b.status !== "written" || !b.sceneContent?.trim());
  if (!queue.length) { onComplete?.(current); return; }

  let firstDone = false;
  let written = 0;
  for (const beat of queue) {
    if (maxScenes != null && written >= maxScenes) break;

    onBeatStart?.(beat.id, beat.index);

    try {
      const action: ActionRequest = {
        type: "generate_scene",
        payload: { beatIndex: beat.index },
      };
      const text = await callGenerate(current, action, profile);
      const sceneText = text.trim();
      if (!sceneText) {
        throw new Error(`Scene "${beat.name}" returned no text.`);
      }

      // Apply the scene write to the loop's local snapshot, then
      // flush to the caller's persistence layer. Match the beat by
      // id (stable) rather than index (could shift if the user edits
      // the beat sheet mid-loop, though unlikely during background
      // generation).
      current = applySceneWrite(current, beat.id, sceneText);
      await persist(current);

      written++;
      const wasFirst = !firstDone;
      firstDone = true;
      onBeatDone?.(beat.id, beat.index, wasFirst);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      onError?.(err, beat.id, beat.index, current);
      return;
    }
  }

  onComplete?.(current);
}

/**
 * Pure helper: write `sceneText` to the beat with `beatId` inside the
 * active story-layer draft, flipping its status to "written". Mirrors
 * the setStory updater used by Studio.tsx's per-beat generator.
 */
function applySceneWrite(story: Story, beatId: string, sceneText: string): Story {
  const sl = getActiveStoryLayerDraft(story);
  if (!sl) return story;
  const writeInto = (arr: Beat[]): Beat[] => arr.map(b =>
    b.id === beatId
      ? { ...b, status: "written" as const, sceneContent: sceneText }
      : b,
  );
  if (story.projectType === "tv-show") {
    return updateStoryLayerDraft(story, {
      episodes: (sl.episodes ?? []).map(ep => ({
        ...ep,
        beats: writeInto(ep.beats),
      })),
    });
  }
  return updateStoryLayerDraft(story, { beats: writeInto(sl.beats) });
}

/** Build the initial pending-beat-id set for a project. Used by the
 *  caller to populate the Script tab's "queued" spinner state before
 *  the loop starts — so beat #1 starts as queued, not idle. */
export function pendingBeatIds(story: Story): Set<string> {
  const sl = getActiveStoryLayerDraft(story);
  if (!sl) return new Set();
  const beats: Beat[] = story.projectType === "tv-show"
    ? (sl.episodes ?? []).flatMap(ep => ep.beats)
    : sl.beats;
  return new Set(
    beats
      .filter(b => b.status !== "written" || !b.sceneContent?.trim())
      .map(b => b.id),
  );
}

/**
 * Prepare a Story for the "Rewrite all scenes with AI (New Draft)"
 * flow. Clones BOTH the active story-layer draft (where scene prose
 * actually lives — `beats[i].sceneContent`) AND the active script-layer
 * draft (so the Script tab's draft picker surfaces a fresh entry users
 * can switch back to). On the cloned story-layer draft every beat is
 * reset to status "design" with empty sceneContent so the script-
 * generation loop sees a full queue and the model isn't anchored on the
 * prior prose.
 *
 * The original drafts are untouched — calling code can persist the
 * returned Story knowing the user can swap back via either layer's
 * draft picker if they prefer the previous take. Sibling helpers in
 * lib/story.ts already handle the project-draft pointer math, so this
 * function is just a thin clone+clear wrapper.
 *
 * Used by app/page.tsx's startBackgroundScriptLoop when the
 * `rewriteNewDraft` option is set; the manual one-shot per-scene
 * rewrite button (see Studio.tsx) does NOT clone — it overwrites the
 * single scene in place because cloning the entire draft for a single
 * paragraph rewrite would be heavy-handed.
 */
export function prepareRewriteNewDraft(story: Story): Story {
  let next = createNewStoryLayerDraft(story);
  const sl = getActiveStoryLayerDraft(next);
  if (sl) {
    const clearBeat = (b: Beat): Beat => ({
      ...b,
      status: "design" as const,
      sceneContent: "",
    });
    if (next.projectType === "tv-show") {
      next = updateStoryLayerDraft(next, {
        episodes: (sl.episodes ?? []).map(ep => ({
          ...ep,
          beats: ep.beats.map(clearBeat),
        })),
      });
    } else {
      next = updateStoryLayerDraft(next, { beats: sl.beats.map(clearBeat) });
    }
  }
  // Pair-clone the script-layer draft so the Script tab's draft picker
  // shows a fresh entry alongside the cloned story draft. The active
  // prose lives on story-layer beats, not on this draft's scenes array,
  // but the picker still surfaces the entry to the user.
  next = createNewScriptDraft(next);
  return next;
}
