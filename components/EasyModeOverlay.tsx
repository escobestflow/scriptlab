"use client";

// Fullscreen overlay shown while Easy mode is running (and on failure).
// Renders on top of every other surface — uses the existing
// .generate-scrim backdrop pattern (z-index 100) and adds a centered
// card with a 4-row progress checklist for Concept → Characters →
// Story → Script.
//
// Two visual states:
//   - Running: spinner + step list, current step animates with a mini
//     spinner, prior steps show a check, future steps show a hollow
//     dot. Caption explicitly tells the user to expect a couple of
//     minutes so they don't bail.
//   - Error: same overall shape but the step list shows the failed
//     step with an error icon, the error message is displayed below,
//     and two buttons appear — Retry the chain, or Open the partial
//     project anyway (lands on whichever upstream layer last got
//     content).
//
// Mounted at the app/page.tsx level (not inside Studio) because the
// overlay needs to be visible during project creation, before the user
// has navigated into Studio at all.

import type { EasyModeStep } from "@/lib/easyMode";
import { Button } from "@/components/ui";

const STEP_LABELS: Record<EasyModeStep, string> = {
  concept:    "Concept",
  characters: "Characters",
  story:      "Story",
  script:     "Script",
};

const STEPS: EasyModeStep[] = ["concept", "characters", "story", "script"];

interface EasyModeOverlayProps {
  /** The step that's currently mid-flight. Steps before it render as
   *  done; the step itself renders with a mini-spinner; steps after
   *  render as pending. Null between mount and the first onStep call. */
  currentStep: EasyModeStep | null;
  /** When set, the run failed and the overlay swaps into error mode.
   *  Steps up to (but not including) `error.step` render as done; the
   *  failing step renders with an error icon; later steps stay pending.
   *  message is surfaced verbatim so the user has something to act on. */
  error: { step: EasyModeStep; message: string } | null;
  /** Re-run the chain from step 1 against the same seed. */
  onRetry: () => void;
  /** Hide the overlay and navigate into the partial project. The caller
   *  decides which layer to land on (typically the most-upstream layer
   *  that got content before the failure). */
  onOpenAnyway: () => void;
}

export function EasyModeOverlay({
  currentStep,
  error,
  onRetry,
  onOpenAnyway,
}: EasyModeOverlayProps) {
  // For each step, decide which visual state to render. Order:
  //   - Error mode: steps before failed → done; failed → error;
  //                 steps after → pending.
  //   - Running mode: steps before currentStep → done; current → active;
  //                   steps after → pending. Null currentStep means the
  //                   chain hasn't started yet (first call to onStep is
  //                   imminent), so show all four pending.
  const stepState = (s: EasyModeStep): "done" | "active" | "error" | "pending" => {
    if (error) {
      const failedIdx = STEPS.indexOf(error.step);
      const stepIdx = STEPS.indexOf(s);
      if (stepIdx < failedIdx) return "done";
      if (stepIdx === failedIdx) return "error";
      return "pending";
    }
    if (!currentStep) return "pending";
    const curIdx = STEPS.indexOf(currentStep);
    const stepIdx = STEPS.indexOf(s);
    if (stepIdx < curIdx) return "done";
    if (stepIdx === curIdx) return "active";
    return "pending";
  };

  return (
    <div className="generate-scrim" role="status" aria-live="polite">
      <div className="easy-mode-card">
        {!error && <div className="generate-scrim-spinner" />}
        <div className="easy-mode-title">
          {error ? "Something went wrong" : "Building your project…"}
        </div>
        <div className="easy-mode-subtitle">
          {error
            ? `We hit an error during ${STEP_LABELS[error.step]}.`
            : "This usually takes a couple of minutes — sit tight."}
        </div>

        <div className="easy-mode-step-list">
          {STEPS.map(s => {
            const state = stepState(s);
            return (
              <div key={s} className={`easy-mode-step is-${state}`}>
                <span className="easy-mode-step-icon" aria-hidden="true">
                  {state === "done"   && "✓"}
                  {state === "error"  && "!"}
                  {state === "active" && <span className="easy-mode-step-spinner" />}
                  {state === "pending" && ""}
                </span>
                <span className="easy-mode-step-label">{STEP_LABELS[s]}</span>
              </div>
            );
          })}
        </div>

        {error && (
          <>
            <div className="easy-mode-error-message">{error.message}</div>
            <div className="easy-mode-actions">
              <Button variant="secondary" size="lg" onClick={onOpenAnyway} block>
                Open project anyway
              </Button>
              <Button variant="primary" size="lg" onClick={onRetry} block>
                Retry
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
