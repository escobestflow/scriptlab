"use client";

// PostLoginTransition — cinematic handoff from the splash-end pose to
// the app's home screen topbar.
//
// Plays immediately after Google sign-in completes, replacing the old
// "Loading your projects…" gray bridge screen. The sequence:
//
//   0–500ms    hold on the splash-end pose (black viewport, centered
//              "Let your story" tagline above the Unfold wordmark)
//   500–900ms  tagline fades out — only the wordmark remains
//   900–1700ms wordmark slides + scales up into the topbar's logo slot
//              (150px → 86px, viewport-center → topbar-center) while
//              the black viewport simultaneously collapses vertically
//              to the topbar's height
//   1800–2050ms overlay as a whole fades to transparent (quick 250ms
//              opacity transition). While we fade, the real app is
//              already mounted behind us, so the user sees a gentle
//              cross-dissolve from the overlay's faux topbar to the
//              real one — never an instant pop.
//   2050ms+   onDone has fired and the parent unmounts us.
//
// The `ready` prop gates the animation: if false, we hold on the
// splash-end pose indefinitely (tagline + centered wordmark over a
// full-viewport black bg). The parent flips `ready` to true once
// projects are hydrated, so when the shrink phase begins the real
// home content is already rendered behind the overlay. As the black
// bar collapses upward toward the topbar, the home content below is
// progressively revealed — no gray bridge, no empty page flash.
//
// The hamburger is owned by the real topbar — we do not render a
// duplicate here, so the only menu icon the user sees is the one
// that stays on screen post-swap.

import { useEffect, useState } from "react";

interface PostLoginTransitionProps {
  /** Fired once the internal sequence finishes. The parent still owns
   *  the unmount decision (it waits for projects to be loaded too). */
  onDone: () => void;
  /** When false, hold indefinitely on the splash-end pose (tagline +
   *  centered wordmark on black). When true, run the full fade →
   *  shrink → fade-out sequence. Defaults to true for backwards-
   *  compatible callers; the home screen passes `ready={hydrated}`
   *  so the animation only kicks off after projects are loaded,
   *  which lets the shrinking black bar reveal real content behind. */
  ready?: boolean;
}

type Phase = "initial" | "fade-tagline" | "shrink" | "bg-fade" | "fade-out" | "done";

export default function PostLoginTransition({ onDone, ready = true }: PostLoginTransitionProps) {
  const [phase, setPhase] = useState<Phase>("initial");

  useEffect(() => {
    // Hold on the initial pose until the parent signals content is
    // ready. This is what makes the "reveal content underneath as the
    // bar shrinks" effect work — we don't want to start shrinking
    // before there's anything behind us to reveal.
    if (!ready) return;
    // 0    : initial — black/light viewport, centered tagline + wordmark
    // 500  : fade-tagline — tagline opacity → 0 (400ms)
    // 1000 : shrink — wordmark animates from center to top-bar pose
    //                 (800ms, settles at 1800)
    // 1500 : bg-fade — light/dark backdrop starts fading (500ms,
    //                  ends at 2000). Per spec, bg begins fading
    //                  300ms BEFORE the logo lands so the surface
    //                  has already started dissolving by the time
    //                  the logo settles.
    // 2000 : fade-out — root opacity → 0 (250ms) so logo + tagline
    //                   cross-dissolve into the real app underneath.
    // 2250 : done — onDone fires, parent unmounts.
    const t1 = setTimeout(() => setPhase("fade-tagline"), 500);
    const t2 = setTimeout(() => setPhase("shrink"), 1000);
    const t3 = setTimeout(() => setPhase("bg-fade"), 1500);
    const t4 = setTimeout(() => setPhase("fade-out"), 2000);
    const t5 = setTimeout(() => {
      setPhase("done");
      onDone();
    }, 2250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [ready, onDone]);

  return (
    <div className={`post-login-transition phase-${phase}`}>
      <div className="post-login-bg" />
      <div className="post-login-tagline">Let your story</div>
      <img className="post-login-logo" src="/logo.svg" alt="Unfold" />

      <style jsx global>{`
        .post-login-transition {
          position: fixed;
          inset: 0;
          z-index: 10000;
          pointer-events: none;
          overflow: hidden;
          opacity: 1;
          transition: opacity 250ms ease-out;
        }
        /* Final quick cross-fade to the real app, which has already
           mounted behind us. Opacity is animated on the root so logo,
           bar, and everything inside fade together — the user sees a
           gentle dissolve instead of a hard unmount pop. */
        .post-login-transition.phase-fade-out,
        .post-login-transition.phase-done {
          opacity: 0;
        }

        /* Full-viewport black box. Stays in place at full viewport
           height through the entire transition — only fades out
           (opacity 1 → 0) once the logo has settled into its top-bar
           pose. (Was previously collapsing vertically, which made
           the background "race up" with the logo; per spec the bg
           should hold steady and dissolve cleanly afterward.) */
        .post-login-bg {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 100vh;
          background: #0b0b0f;
          opacity: 1;
          transition: opacity 500ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .post-login-transition.phase-bg-fade .post-login-bg,
        .post-login-transition.phase-fade-out .post-login-bg,
        .post-login-transition.phase-done .post-login-bg {
          opacity: 0;
        }

        /* Tagline — same pose, font, and typography as the splash's
           end-state tagline so the handoff is pixel-continuous. */
        .post-login-tagline {
          position: absolute;
          top: calc(50% - 18px);
          left: 50%;
          transform: translate(-50%, -50%);
          color: #ffffff;
          font-family: 'Lato', sans-serif;
          font-weight: 300;
          font-size: 12px;
          letter-spacing: 0.04em;
          white-space: nowrap;
          opacity: 1;
          transition: opacity 400ms cubic-bezier(0.22, 0.61, 0.36, 1);
        }
        .post-login-transition.phase-fade-tagline .post-login-tagline,
        .post-login-transition.phase-shrink .post-login-tagline,
        .post-login-transition.phase-fade-out .post-login-tagline,
        .post-login-transition.phase-done .post-login-tagline {
          opacity: 0;
        }

        /* Logo — starts in the splash-end pose (150px, viewport center)
           and animates to the topbar-center pose (86px, top of viewport)
           during the "shrink" phase. Position/width are both animated on
           the same duration + easing so the motion reads as one gesture.
           logo.svg is authored black; invert to white to match the dark
           topbar and the splash's white wordmark. */
        .post-login-logo {
          position: absolute;
          top: calc(50% + 12px);
          left: 50%;
          width: 150px;
          /* Explicit aspect-preserving height (150 x 18.5 / 86 ~= 32.27px)
             so the height property can interpolate smoothly into the
             shrink-state height -- "height: auto" cannot animate. */
          height: calc(150px * 18.5 / 86);
          transform: translate(-50%, -50%);
          filter: invert(1);
          transition:
            top 800ms cubic-bezier(0.22, 1, 0.36, 1),
            width 800ms cubic-bezier(0.22, 1, 0.36, 1),
            height 800ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .post-login-transition.phase-shrink .post-login-logo,
        .post-login-transition.phase-fade-out .post-login-logo,
        .post-login-transition.phase-done .post-login-logo {
          /* Match .brand-logo-img inside .topbar-center: vertically
             centered within the topbar padding, 82px wide. Per
             latest spec, lifted 8px higher than the prior +12 nudge
             — the trailing offset goes 12 → 4 so the logo settles
             into its topbar pose 8px sooner.
             Height is the aspect-preserving value for 82px width
             (~17.64px) +1px — per-design tweak to match the live
             wordmark rendered height on device (SVG gets stretched
             slightly taller than its intrinsic aspect). */
          top: calc(env(safe-area-inset-top, 0px) + 14px + 18.5px / 2 + 4px);
          width: 82px;
          height: calc(82px * 18.5 / 86 + 1px);
        }

        /* Center-constrain the overlay to the same max-width as the
           rest of the app shell so it doesn't bleed past the 520px
           reading column on wide viewports. */
        @media (min-width: 540px) {
          .post-login-transition {
            max-width: 520px;
            left: 50%;
            right: auto;
            transform: translateX(-50%);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .post-login-bg,
          .post-login-tagline,
          .post-login-logo {
            transition-duration: 200ms !important;
          }
        }
      `}</style>
    </div>
  );
}
