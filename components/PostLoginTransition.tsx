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
//   1400–1800ms hamburger menu icon fades in over the shrinking strip,
//              timed to land on the topbar just as the strip reaches
//              its final height
//   1800ms+    hold at the final pose (visually identical to the real
//              topbar: black strip, logo, hamburger) until the parent
//              unmounts us
//
// The parent keeps this component mounted while `!hydrated || !done`,
// so if projects finish loading mid-animation we still play the full
// sequence. Once `onDone` fires AND hydration is complete, the parent
// swaps us out for the real app. Because our final pose mirrors the
// real topbar pixel-for-pixel, the swap is seamless.

import { useEffect, useState } from "react";

interface PostLoginTransitionProps {
  /** Fired once the internal sequence finishes. The parent still owns
   *  the unmount decision (it waits for projects to be loaded too). */
  onDone: () => void;
}

type Phase = "initial" | "fade-tagline" | "shrink" | "done";

export default function PostLoginTransition({ onDone }: PostLoginTransitionProps) {
  const [phase, setPhase] = useState<Phase>("initial");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("fade-tagline"), 500);
    const t2 = setTimeout(() => setPhase("shrink"), 1000);
    const t3 = setTimeout(() => {
      setPhase("done");
      onDone();
    }, 1900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onDone]);

  return (
    <div className={`post-login-transition phase-${phase}`}>
      <div className="post-login-bg" />
      <div className="post-login-tagline">Let your story</div>
      <img className="post-login-logo" src="/logo.svg" alt="Unfold" />
      <span className="post-login-menu" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>

      <style jsx global>{`
        .post-login-transition {
          position: fixed;
          inset: 0;
          z-index: 10000;
          pointer-events: none;
          overflow: hidden;
        }

        /* Full-viewport black box that collapses vertically to the
           topbar's height during the "shrink" phase. Height drives
           the "container shrinks to the size of the top nav bar"
           behavior described in the spec. */
        .post-login-bg {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 100vh;
          background: #0b0b0f;
          transition: height 800ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .post-login-transition.phase-shrink .post-login-bg,
        .post-login-transition.phase-done .post-login-bg {
          /* Mirrors the real .topbar's outer box on the dark home
             header: safe-area-top + 14px padding + 18.5px logo + 14px
             padding. When this value matches the real topbar, the
             unmount is visually seamless. */
          height: calc(env(safe-area-inset-top, 0px) + 14px + 18.5px + 14px);
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
          height: auto;
          transform: translate(-50%, -50%);
          filter: invert(1);
          transition:
            top 800ms cubic-bezier(0.22, 1, 0.36, 1),
            width 800ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .post-login-transition.phase-shrink .post-login-logo,
        .post-login-transition.phase-done .post-login-logo {
          /* Match .brand-logo-img inside .topbar-center: vertically
             centered within the topbar padding, 86px wide. */
          top: calc(env(safe-area-inset-top, 0px) + 14px + 18.5px / 2);
          width: 86px;
        }

        /* Hamburger — fixed at the topbar's left slot, hidden at start,
           fades in as the black box reaches its final height. Mirrors
           the real .menu-toggle span geometry so the swap to the real
           topbar is invisible. */
        .post-login-menu {
          position: absolute;
          top: calc(env(safe-area-inset-top, 0px) + 14px + 18.5px / 2);
          left: 42px; /* .topbar padding-left (20) + .topbar-btn width/2 (22) */
          transform: translate(-50%, -50%);
          width: 22px;
          height: 15px;
          opacity: 0;
          transition: opacity 400ms cubic-bezier(0.22, 0.61, 0.36, 1)
            400ms;
        }
        .post-login-menu span {
          position: absolute;
          left: 0;
          height: 2px;
          border-radius: 2px;
          background: #ffffff;
        }
        .post-login-menu span:nth-child(1) {
          top: 0;
          width: 12px;
        }
        .post-login-menu span:nth-child(2) {
          top: 6.5px;
          width: 22px;
        }
        .post-login-menu span:nth-child(3) {
          top: 13px;
          width: 17px;
        }
        .post-login-transition.phase-shrink .post-login-menu,
        .post-login-transition.phase-done .post-login-menu {
          opacity: 1;
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
          .post-login-logo,
          .post-login-menu {
            transition-duration: 200ms !important;
          }
        }
      `}</style>
    </div>
  );
}
