"use client";

// SplashLoader — Unfold's first-paint animated brand splash.
//
// Plays a 6.59s paper-unfolding SVG composition (32-word grid of
// screenwriting concepts) that cross-fades into the Unfold wordmark,
// tagline, and — if the viewer isn't signed in — a Google sign-in
// button. Replaces the old static sign-in screen.
//
// Timing map (mirrors the CSS keyframe schedule, do not drift):
//   0.00–3.89s  6 accelerating unfold steps
//   3.89–4.39s  hold on full composition
//   4.39–4.89s  stage fades out
//   4.89–5.29s  tagline "Let your story" fades in
//   5.49–5.99s  logo (unfold wordmark) fades in underneath
//   6.19–6.59s  sign-in button fades in (signed-out only)
//
// The tagline + wordmark together read "Let your story / unfold" as
// two stacked lines — the tagline lands first, the wordmark completes
// the sentence.
//
// Lifecycle:
//   - Signed-in: auto-dismiss at ~6.2s after mount.
//   - Signed-out: button appears at 6.19s; clicking it triggers Google
//     OAuth (supabase.auth.signInWithOAuth). After redirect-back, the
//     session resolves and the parent navigates past the splash.
//
// Auth state changes are reactive: if Supabase confirms a session mid-
// animation we flip data-auth and hide the button; if a session arrives
// after the button is already visible we fade the splash out.

import { useEffect, useRef, useState } from "react";

// Animation end timestamps (ms from mount).
// Button fade finishes at 6.59s; leave 110ms safety buffer.
const ANIM_END_SIGNED_IN_MS = 6200;
const ANIM_END_SIGNED_OUT_MS = 6700;

interface SplashLoaderProps {
  /** True while Supabase is still restoring the session. */
  authLoading: boolean;
  /** Null until a session exists. */
  signedIn: boolean;
  /** Kicks off Google OAuth. Browser redirects; no promise result used. */
  signInWithGoogle: () => Promise<void>;
  /** Called once the splash has fully faded out. Parent unmounts us. */
  onDismiss: () => void;
}

export default function SplashLoader({
  authLoading,
  signedIn,
  signInWithGoogle,
  onDismiss,
}: SplashLoaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Anchor timing to first render so timers stay accurate even if the
  // parent's state changes mid-animation.
  const startedAtRef = useRef<number>(Date.now());
  const [dismissing, setDismissing] = useState(false);
  const dismissedRef = useRef(false);
  // Skip-intro state: when true, all in-flight animations are overridden
  // to their final frame via CSS ([data-skipped="true"]). For signed-out
  // users the Google button takes the Skip CTA's spot instantly; for
  // signed-in users we dismiss straight into the app.
  const [skipped, setSkipped] = useState(false);

  // Resolved auth state — drives the data-auth attribute that controls
  // sign-in button visibility via CSS. While auth is loading, default to
  // "signed-out" so the button animation pre-plays; if auth later
  // resolves to signed-in we flip it (and the CSS hides the button
  // instantly, then we auto-dismiss).
  const authState: "signed-in" | "signed-out" =
    !authLoading && signedIn ? "signed-in" : "signed-out";

  // Single dismiss path — idempotent.
  //
  // Dismissal hands off directly to <PostLoginTransition>, whose
  // initial pose (black viewport + centered "Let your story" tagline
  // + Unfold wordmark below) mirrors the splash's end frame. Because
  // the poses are visually identical, we DON'T fade the splash out;
  // a fade would expose the body background between the two surfaces
  // and flash (especially in light mode). Instead we drop the splash
  // instantly and let the transition component take over.
  async function dismiss() {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss();
  }

  // Auto-dismiss path: once auth resolves as signed-in, dismiss the
  // moment the animation finishes (or immediately if already past end).
  useEffect(() => {
    if (authState !== "signed-in" || dismissedRef.current) return;
    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(0, ANIM_END_SIGNED_IN_MS - elapsed);
    const t = setTimeout(() => {
      void dismiss();
    }, remaining);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // Skip Intro tap handler. Flipping `skipped` fast-forwards the CSS
  // animations to their final frame (tagline + wordmark at opacity 1;
  // SVG stage at opacity 0; the sign-in button becomes visible in the
  // Skip CTA's exact spot). If the viewer is already signed in, skip
  // straight past the end-state into the app instead of pausing there.
  const handleSkip = () => {
    if (skipped || dismissedRef.current) return;
    setSkipped(true);
    if (authState === "signed-in") {
      void dismiss();
    }
  };

  async function handleSignIn() {
    // supabase.auth.signInWithOAuth({ provider: "google" }) redirects
    // the whole page to Google's consent screen, so we don't need to
    // dismiss — the navigation tears the splash down for us.
    //
    // IMPORTANT: set the "splash seen" flag BEFORE the redirect leaves.
    // sessionStorage survives the Google OAuth round-trip (same-tab,
    // same-origin on return), so when the user lands back on the app
    // with a fresh session the splash skips itself instead of replaying
    // a full 6.59s intro. Wrap in try/catch because storage can throw
    // in private/partitioned contexts — worst case the splash replays.
    try { window.sessionStorage.setItem("unfoldSplashSeen", "1"); } catch {}
    await signInWithGoogle();
  }

  return (
    <div
      ref={rootRef}
      data-splash-root
      data-auth={authState}
      data-skipped={skipped ? "true" : "false"}
      className={dismissing ? "splash-dismissed" : ""}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000000",
        overflow: "hidden",
      }}
    >
      {/* Unfold logo (white wordmark) — fades in after stage fades out. */}
      <svg className="unfold-logo" viewBox="0 0 86 19" aria-label="Unfold">
        <path d="M84.302 0.164235L84.364 0.302284C84.4568 5.36398 84.2144 10.4618 84.4035 15.5143C84.419 15.9281 84.3582 17.1659 84.6827 17.4364C84.8647 17.5881 85.9449 17.605 85.998 17.6596L86.0001 18.0579H80.4861L80.4882 17.6596C80.5329 17.6136 81.5473 17.5692 81.7548 17.4676C82.1287 17.2844 82.0702 15.9718 82.0847 15.5964C82.1456 14.0312 82.2472 12.0147 82.1257 10.4706C81.9678 8.46357 80.3109 6.59616 78.268 6.44936C74.2068 6.15749 73.6807 11.0756 74.1845 14.0632C74.5174 16.0376 75.6444 18.0217 77.8092 18.2578L77.8091 18.5384C76.1881 18.5083 74.7559 17.9036 73.6728 16.6974C71.3635 14.1253 71.2886 10.3544 73.6524 7.78895C75.839 5.41577 80.1563 5.23109 81.8214 8.29361L82.1239 8.89066C82.1323 7.32292 82.1148 5.75381 82.1227 4.18561C82.1268 3.3599 82.3045 2.00464 81.9317 1.25786C81.6794 0.752739 81.1995 0.678456 80.6862 0.644171C80.7054 0.48989 80.6294 0.280085 80.7458 0.164185H84.3019L84.302 0.164235Z" fill="#FFFFFF"/>
        <path d="M3.47617 5.84905L3.4745 15.1578C3.58358 18.473 6.82802 18.5409 8.75155 16.4782C9.51972 15.6545 10.0478 14.6963 10.1107 13.5566C10.2205 11.5663 10.0623 9.4315 10.0633 7.43601C9.92629 6.65307 9.52537 6.28317 8.71036 6.32959L8.71056 5.849H12.2667V16.1569C12.2667 16.2649 12.3875 16.6691 12.4362 16.7878C12.6643 17.3441 13.1048 17.4487 13.6654 17.4577L13.6652 17.9382H10.1091V15.2962L9.52623 16.2135C7.94108 18.8109 2.64551 19.5336 1.64143 16.1136C0.938672 13.7201 1.56006 10.2275 1.35993 7.66897C1.33373 7.33432 1.1807 6.77246 0.916715 6.55184C0.673126 6.3483 0.306935 6.35831 0.0174641 6.29187L0 5.849H3.47627L3.47617 5.84905Z" fill="#FFFFFF"/>
        <path d="M66.6344 0.0850115L66.6325 13.7974C66.7249 14.6966 66.6419 15.6163 66.7149 16.517C66.7311 16.7162 66.8322 17.2386 66.9968 17.3554C67.2246 17.517 67.999 17.4809 68.2893 17.5739L68.3126 17.9787H62.7586L62.7819 17.5739C63.0659 17.484 63.8973 17.513 64.0982 17.3392C64.2128 17.2402 64.3408 16.7958 64.3565 16.6373C64.412 16.0767 64.3791 15.4778 64.3952 14.9147C64.5183 10.6025 64.3901 6.26643 64.4362 1.94706C64.3576 1.06364 63.9262 0.533595 62.9981 0.565554L62.9984 0.0849609H66.6344V0.0850115Z" fill="#FFFFFF"/>
        <path d="M36.2541 6.68958C36.28 6.0496 36.2199 5.38368 36.2524 4.74642C36.2975 3.86291 36.5657 3.15663 37.0606 2.43372C37.9048 1.20058 39.3003 0.133865 40.8287 0.00390625L39.7494 0.684038C38.5107 1.72583 38.5514 2.85854 38.4933 4.34942C38.4678 5.00523 38.3746 5.91069 38.4497 6.55148C38.4565 6.60973 38.4546 6.65439 38.5117 6.68953H42.0079V7.08982H38.5117L38.4497 7.22787C38.4395 9.45678 38.4518 11.6908 38.4933 13.9134C38.5073 14.6627 38.3927 16.5931 38.7034 17.1857C38.7377 17.2513 38.771 17.3323 38.839 17.37C39.0373 17.4801 40.089 17.5268 40.1244 17.5836L40.13 17.9782H34.576L34.5992 17.5734C34.8899 17.4797 35.6718 17.5158 35.8939 17.357C36.0179 17.2683 36.1522 16.8275 36.1699 16.6729C36.2474 15.9951 36.1626 15.2737 36.2558 14.5972L36.2541 7.08982H34.5759V6.68953L36.2541 6.68958Z" fill="#FFFFFF"/>
        <path d="M21.1239 5.8894L21.1222 13.8771C21.2154 14.7607 21.1293 15.6666 21.2089 16.5524C21.2253 16.735 21.3364 17.249 21.4864 17.3553C21.7147 17.5171 22.488 17.4808 22.7788 17.5739L22.802 17.9787H17.248L17.2713 17.5739C17.5554 17.4839 18.3866 17.5129 18.5876 17.3392C18.717 17.2274 18.8288 16.7728 18.8457 16.597C18.9092 15.9362 18.842 15.2562 18.9279 14.5977C18.7805 12.3771 19.1214 9.90759 18.9211 7.71595C18.8424 6.85474 18.4057 6.29541 17.4875 6.37L17.4878 5.8894H21.1238H21.1239Z" fill="#FFFFFF"/>
        <path d="M25.9583 17.9783L25.9816 17.5736C26.2462 17.4846 26.952 17.5162 27.155 17.3559C27.2825 17.2552 27.3712 16.8751 27.3918 16.7124C27.4576 16.193 27.4192 15.6368 27.435 15.1145C27.4851 13.4668 27.5073 11.7995 27.4371 10.152C27.379 8.78857 27.4394 7.74825 26.1303 6.97775C25.0956 6.36877 23.8717 6.34202 22.7048 6.45195L22.641 6.23107C24.4395 5.73263 27.5976 5.88256 28.8556 7.44985C29.3943 8.12083 29.4289 9.1298 29.4749 9.95183C29.5888 11.9838 29.4569 14.0439 29.5527 16.0786C29.5621 16.2764 29.5811 16.553 29.6055 16.7463C29.6238 16.8906 29.727 17.2666 29.8352 17.3569C30.0198 17.5109 30.7584 17.4879 31.0096 17.5737L31.0329 17.9784H25.9583V17.9783Z" fill="#FFFFFF"/>
        <path d="M53.5016 18.0588V17.7782C54.1206 17.7652 54.772 17.4075 55.2557 17.0337C56.8877 15.7725 57.0662 13.2334 56.9796 11.3117C56.8816 9.13664 56.3156 7.13659 54.1517 6.25889C53.9104 6.16105 53.4736 6.17703 53.6834 5.84839C56.2295 6.2908 58.7344 8.25894 59.1241 10.9247C59.372 12.6205 59.0207 14.4631 57.8776 15.7774C56.8095 17.0055 55.1204 17.8996 53.5016 18.0588Z" fill="#FFFFFF"/>
        <path d="M51.6637 5.849L51.6646 6.10983C49.6345 6.61489 48.7461 8.23872 48.4731 10.1983C48.1655 12.4066 48.2549 15.8311 50.3002 17.2032C50.7254 17.4885 51.3092 17.7747 51.824 17.7782V18.0588C50.4519 17.9271 48.9611 17.213 47.9475 16.2778C46.4722 14.9169 45.9238 12.8486 46.2415 10.8848C46.6716 8.22658 49.1059 6.28373 51.6637 5.849H51.6637Z" fill="#FFFFFF"/>
        <path d="M41.249 0.0441078C41.2409 -0.0313894 41.3327 0.0119974 41.3767 0.0161945C42.4914 0.121577 43.806 0.364958 44.5456 1.28513C45.3476 2.28283 44.3458 3.20022 43.3933 2.47964C42.8715 2.08491 42.9437 1.48912 42.5478 1.00489C42.218 0.601563 41.7137 0.270498 41.249 0.0441583L41.249 0.0441078Z" fill="#FFFFFF"/>
      </svg>

      <div className="unfold-tagline">Let your story</div>

      <button className="signin-btn" type="button" onClick={handleSignIn}>
        <svg className="google-icon" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
          <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
          <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
          <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
        </svg>
        <span>Sign in with Google</span>
      </button>

      {/* Skip Intro — small text CTA pinned at the bottom of the
          loader. Tapping fast-forwards to the final frame: SVG stage
          hides, tagline + wordmark snap to full opacity, and for
          signed-out viewers the Google button instantly occupies the
          Skip CTA's spot (same bottom: 48px anchor). Hidden once
          `skipped` flips via the [data-skipped] attribute on the root. */}
      <button
        type="button"
        className="splash-skip-btn"
        onClick={handleSkip}
        aria-label="Skip intro"
      >
        Skip Intro
      </button>

      {/* Vignette overlay — loaded from /public/vignette.svg so the
          asset can be swapped without touching component code. The
          image stretches to fill the viewport (see .vignette-overlay
          in the style block below: 100% x 100% on an <img> uses the
          default object-fit: fill — exactly the "stretch to viewport"
          behavior we want). */}
      <img className="vignette-overlay" src="/vignette.svg" alt="" aria-hidden="true" />

      <div className="stage">
        {/* ===== STEP 6: OUTERMOST TOP ROW ===== */}
        <div className="panel row-top-outer2">
          <svg className="panel-shape" viewBox="0 0 400 100" preserveAspectRatio="none">
            <polygon points="58,50 342,50 399.5,100 0.5,100" fill="#000000" stroke="none">
              <animate attributeName="points" values="58,50 342,50 399.5,100 0.5,100; 0.5,0.5 399.5,0.5 399.5,100 0.5,100" keyTimes="0;1" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="0.5,100 58,50 342,50 399.5,100" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="0.5,100 58,50 342,50 399.5,100; 0.5,100 0.5,0.5 399.5,0.5 399.5,100" keyTimes="0;1" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="100" y1="50" x2="100" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="199.5" y1="50" x2="199.5" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="299" y1="50" x2="299" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-col1">spark</span>
          <span className="panel-label label-col2">hook</span>
          <span className="panel-label label-col3">pitch</span>
          <span className="panel-label label-col4">voice</span>
        </div>

        {/* ===== STEP 6: OUTERMOST BOTTOM ROW ===== */}
        <div className="panel row-bot-outer2">
          <svg className="panel-shape" viewBox="0 0 400 100" preserveAspectRatio="none">
            <polygon points="0.5,0 399.5,0 342,50 58,50" fill="#000000" stroke="none">
              <animate attributeName="points" values="0.5,0 399.5,0 342,50 58,50; 0.5,0 399.5,0 399.5,99.5 0.5,99.5" keyTimes="0;1" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="0.5,0 58,50 342,50 399.5,0" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="0.5,0 58,50 342,50 399.5,0; 0.5,0 0.5,99.5 399.5,99.5 399.5,0" keyTimes="0;1" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="100" y1="0" x2="100" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="199.5" y1="0" x2="199.5" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="299" y1="0" x2="299" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.12s" begin="3.69s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-col1">fade</span>
          <span className="panel-label label-col2">montage</span>
          <span className="panel-label label-col3">flashback</span>
          <span className="panel-label label-col4">voiceover</span>
        </div>

        {/* ===== STEP 5: OUTER TOP ROW ===== */}
        <div className="panel row-top-outer">
          <svg className="panel-shape" viewBox="0 0 400 100" preserveAspectRatio="none">
            <polygon points="58,50 342,50 399.5,100 0.5,100" fill="#000000" stroke="none">
              <animate attributeName="points" values="58,50 342,50 399.5,100 0.5,100; 0.5,0.5 399.5,0.5 399.5,100 0.5,100" keyTimes="0;1" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="0.5,100 58,50 342,50 399.5,100" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="0.5,100 58,50 342,50 399.5,100; 0.5,100 0.5,0.5 399.5,0.5 399.5,100" keyTimes="0;1" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="100" y1="50" x2="100" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="199.5" y1="50" x2="199.5" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="299" y1="50" x2="299" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-col1">vision</span>
          <span className="panel-label label-col2">logline</span>
          <span className="panel-label label-col3">outline</span>
          <span className="panel-label label-col4">style</span>
        </div>

        {/* ===== STEP 5: OUTER BOTTOM ROW ===== */}
        <div className="panel row-bot-outer">
          <svg className="panel-shape" viewBox="0 0 400 100" preserveAspectRatio="none">
            <polygon points="0.5,0 399.5,0 342,50 58,50" fill="#000000" stroke="none">
              <animate attributeName="points" values="0.5,0 399.5,0 342,50 58,50; 0.5,0 399.5,0 399.5,99.5 0.5,99.5" keyTimes="0;1" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="0.5,0 58,50 342,50 399.5,0" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="0.5,0 58,50 342,50 399.5,0; 0.5,0 0.5,99.5 399.5,99.5 399.5,0" keyTimes="0;1" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="100" y1="0" x2="100" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="199.5" y1="0" x2="199.5" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="299" y1="0" x2="299" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.15s" begin="3.40s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-col1">subtext</span>
          <span className="panel-label label-col2">motif</span>
          <span className="panel-label label-col3">symbol</span>
          <span className="panel-label label-col4">metaphor</span>
        </div>

        {/* ===== STEP 4: TOP ROW ===== */}
        <div className="panel row0">
          <svg className="panel-shape" viewBox="0 0 400 100" preserveAspectRatio="none">
            <polygon points="58,50 342,50 399.5,100 0.5,100" fill="#000000" stroke="none">
              <animate attributeName="points" values="58,50 342,50 399.5,100 0.5,100; 0.5,0.5 399.5,0.5 399.5,100 0.5,100" keyTimes="0;1" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="0.5,100 58,50 342,50 399.5,100" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="0.5,100 58,50 342,50 399.5,100; 0.5,100 0.5,0.5 399.5,0.5 399.5,100" keyTimes="0;1" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="100" y1="50" x2="100" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="199.5" y1="50" x2="199.5" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="299" y1="50" x2="299" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y1" from="50" to="0.5" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-col1">premise</span>
          <span className="panel-label label-col2">conflict</span>
          <span className="panel-label label-col3">structure</span>
          <span className="panel-label label-col4">stakes</span>
        </div>

        {/* ===== STEP 4: BOTTOM ROW ===== */}
        <div className="panel row3">
          <svg className="panel-shape" viewBox="0 0 400 100" preserveAspectRatio="none">
            <polygon points="0.5,0 399.5,0 342,50 58,50" fill="#000000" stroke="none">
              <animate attributeName="points" values="0.5,0 399.5,0 342,50 58,50; 0.5,0 399.5,0 399.5,99.5 0.5,99.5" keyTimes="0;1" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="0.5,0 58,50 342,50 399.5,0" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="0.5,0 58,50 342,50 399.5,0; 0.5,0 0.5,99.5 399.5,99.5 399.5,0" keyTimes="0;1" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="100" y1="0" x2="100" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="199.5" y1="0" x2="199.5" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
            <line x1="299" y1="0" x2="299" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.20s" begin="3.02s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-col1">scene</span>
          <span className="panel-label label-col2">dialogue</span>
          <span className="panel-label label-col3">action</span>
          <span className="panel-label label-col4">beat</span>
        </div>

        {/* ===== STEP 3: LEFT COLUMN ===== */}
        <div className="panel col-left">
          <svg className="panel-shape" viewBox="0 0 100 200" preserveAspectRatio="none">
            <polygon points="100,0.5 50,29 50,171 100,199.5" fill="#000000" stroke="none">
              <animate attributeName="points" values="100,0.5 50,29 50,171 100,199.5; 100,0.5 0.5,0.5 0.5,199.5 100,199.5" keyTimes="0;1" dur="0.28s" begin="2.50s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="100,0.5 50,29 50,171 100,199.5" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="100,0.5 50,29 50,171 100,199.5; 100,0.5 0.5,0.5 0.5,199.5 100,199.5" keyTimes="0;1" dur="0.28s" begin="2.50s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="50" y1="100" x2="100" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="x1" from="50" to="0.5" dur="0.28s" begin="2.50s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-top">genre</span>
          <span className="panel-label label-bottom">theme</span>
        </div>

        {/* ===== STEP 3: RIGHT COLUMN ===== */}
        <div className="panel col-right">
          <svg className="panel-shape" viewBox="0 0 100 200" preserveAspectRatio="none">
            <polygon points="0,0.5 50,29 50,171 0,199.5" fill="#000000" stroke="none">
              <animate attributeName="points" values="0,0.5 50,29 50,171 0,199.5; 0,0.5 99.5,0.5 99.5,199.5 0,199.5" keyTimes="0;1" dur="0.28s" begin="2.50s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="0,0.5 50,29 50,171 0,199.5" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="0,0.5 50,29 50,171 0,199.5; 0,0.5 99.5,0.5 99.5,199.5 0,199.5" keyTimes="0;1" dur="0.28s" begin="2.50s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="0" y1="100" x2="50" y2="100" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="x2" from="50" to="99.5" dur="0.28s" begin="2.50s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-top">tone</span>
          <span className="panel-label label-bottom">arc</span>
        </div>

        {/* ===== ROW 2 ===== */}
        <div className="panel row2">
          <svg className="panel-shape" viewBox="0 0 200 100" preserveAspectRatio="none">
            <polygon points="0.5,0 198.5,0 170,50 29,50" fill="#000000" stroke="none">
              <animate attributeName="points" values="0.5,0 198.5,0 170,50 29,50; 0.5,0 198.5,0 198.5,99.5 0.5,99.5" keyTimes="0;1" dur="0.35s" begin="1.85s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polygon>
            <polyline points="0.5,0 29,50 170,50 198.5,0" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
              <animate attributeName="points" values="0.5,0 29,50 170,50 198.5,0; 0.5,0 0.5,99.5 198.5,99.5 198.5,0" keyTimes="0;1" dur="0.35s" begin="1.85s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </polyline>
            <line x1="99.5" y1="0" x2="99.5" y2="50" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <animate attributeName="y2" from="50" to="99.5" dur="0.35s" begin="1.85s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
            </line>
          </svg>
          <span className="panel-label label-story">story</span>
          <span className="panel-label label-script">script</span>
        </div>

        {/* ===== ROW 1 (top layer, slides up) ===== */}
        <div className="row-1">
          <div className="panel characters">
            <svg className="panel-shape" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon points="0.5,0.5 50,14.5 50,85.5 0.5,99.5" fill="#000000" stroke="none">
                <animate attributeName="points" values="0.5,0.5 50,14.5 50,85.5 0.5,99.5; 0.5,0.5 99.5,0.5 99.5,99.5 0.5,99.5" keyTimes="0;1" dur="0.45s" begin="1.00s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
              </polygon>
              <polyline points="0.5,0.5 50,14.5 50,85.5 0.5,99.5" fill="none" stroke="#555555" strokeWidth="1" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
                <animate attributeName="points" values="0.5,0.5 50,14.5 50,85.5 0.5,99.5; 0.5,0.5 99.5,0.5 99.5,99.5 0.5,99.5" keyTimes="0;1" dur="0.45s" begin="1.00s" fill="freeze" calcMode="spline" keySplines="0.33 0.55 0.5 0.95"/>
              </polyline>
            </svg>
            <span className="panel-label">characters</span>
          </div>

          <div className="panel idea">
            <svg className="panel-shape" viewBox="0 0 100 100" preserveAspectRatio="none">
              <rect x="0.5" y="0.5" width="99" height="99" fill="#000000" stroke="#555555" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
            </svg>
            <span className="panel-label">idea</span>
          </div>
        </div>
      </div>

      <style jsx global>{`
        /* Scope everything to [data-splash-root] so the animation's class
           names (.stage, .panel, etc.) don't bleed into the rest of the app. */

        [data-splash-root] .stage {
          width: 100%;
          height: 100%;
          position: relative;
          animation: unfoldSplashStageFadeOut 0.50s cubic-bezier(0.22, 0.61, 0.36, 1) 4.39s forwards;
        }

        [data-splash-root] .vignette-overlay {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 5;
        }

        /* Tagline now lands FIRST (on top), then the logo fades in UNDER
           it — together they read "Let your story / unfold" as two
           stacked lines. */
        [data-splash-root] .unfold-tagline {
          position: absolute;
          top: calc(50% - 18px);
          left: 50%;
          transform: translate(-50%, -50%);
          color: #FFFFFF;
          font-family: 'Lato', sans-serif;
          font-weight: 300;
          font-size: 12px;
          letter-spacing: 0.04em;
          opacity: 0;
          z-index: 6;
          pointer-events: none;
          white-space: nowrap;
          animation: unfoldSplashLogoFadeIn 0.40s cubic-bezier(0.22, 0.61, 0.36, 1) 4.89s forwards;
        }

        [data-splash-root] .unfold-logo {
          position: absolute;
          top: calc(50% + 12px);
          left: 50%;
          width: 150px;
          height: auto;
          transform: translate(-50%, -50%);
          opacity: 0;
          z-index: 6;
          pointer-events: none;
          animation: unfoldSplashLogoFadeIn 0.50s cubic-bezier(0.22, 0.61, 0.36, 1) 5.49s forwards;
        }

        [data-splash-root] .signin-btn {
          position: absolute;
          bottom: 48px;
          left: 50%;
          transform: translateX(-50%);
          width: calc(100% - 48px);
          max-width: 320px;
          height: 50px;
          border-radius: 15px;
          background: #FFFFFF;
          color: #000000;
          border: none;
          padding: 0 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          font-family: 'Lato', sans-serif;
          font-weight: 400;
          font-size: 12px;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          cursor: pointer;
          opacity: 0;
          z-index: 6;
          animation: unfoldSplashLogoFadeIn 0.40s cubic-bezier(0.22, 0.61, 0.36, 1) 6.19s forwards;
        }

        [data-splash-root] .google-icon {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }

        /* Auth-state hook — hide button when already signed in. */
        [data-splash-root][data-auth="signed-in"] .signin-btn {
          display: none !important;
        }

        /* Skip Intro — small uppercase text CTA at the bottom of the
           splash. Fades in alongside the first unfold step (0.6s) so
           it's reachable throughout the animation, and disappears the
           moment the user taps it (the Google button then slides into
           its spot via [data-skipped="true"] overrides below). */
        [data-splash-root] .splash-skip-btn {
          position: absolute;
          bottom: 48px;
          left: 50%;
          transform: translateX(-50%);
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.55);
          font-family: 'Lato', sans-serif;
          font-weight: 500;
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          padding: 12px 18px;
          cursor: pointer;
          opacity: 0;
          z-index: 7;
          animation: unfoldSplashLogoFadeIn 0.4s cubic-bezier(0.22, 0.61, 0.36, 1) 0.6s forwards;
        }
        [data-splash-root] .splash-skip-btn:hover,
        [data-splash-root] .splash-skip-btn:active {
          color: #ffffff;
        }
        /* Hide Skip once it's been tapped — the Google button (or
           dismiss) takes over. Also hide once the Google button is
           mid-fade so the two CTAs don't overlap at the same anchor. */
        [data-splash-root][data-skipped="true"] .splash-skip-btn,
        [data-splash-root][data-auth="signed-in"] .splash-skip-btn {
          display: none !important;
        }

        /* ===== Skip-to-end-state overrides ===========================
           When the user taps Skip Intro we collapse every running
           animation to its final frame. The SVG stage + vignette hide
           instantly; tagline, wordmark, and (for signed-out) the
           Google button snap to opacity 1. No transition — this is a
           deliberate cut, not a second animation. */
        [data-splash-root][data-skipped="true"] .stage,
        [data-splash-root][data-skipped="true"] .vignette-overlay {
          animation: none !important;
          opacity: 0 !important;
        }
        [data-splash-root][data-skipped="true"] .unfold-tagline,
        [data-splash-root][data-skipped="true"] .unfold-logo {
          animation: none !important;
          opacity: 1 !important;
        }
        [data-splash-root][data-skipped="true"][data-auth="signed-out"] .signin-btn {
          animation: none !important;
          opacity: 1 !important;
        }

        /* Dismiss transition — fades the whole splash over 400ms. */
        [data-splash-root].splash-dismissed {
          opacity: 0 !important;
          transition: opacity 0.4s cubic-bezier(0.22, 0.61, 0.36, 1);
          pointer-events: none;
        }

        /* ===== Row 1 slide-up wrapper ===== */
        [data-splash-root] .row-1 {
          position: absolute;
          inset: 0;
          animation: unfoldSplashRow1SlideUp 0.35s cubic-bezier(0.33, 0.55, 0.5, 0.95) 1.85s forwards;
        }

        /* ===== Panel base ===== */
        [data-splash-root] .panel {
          position: absolute;
          top: 50%;
          left: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          font-family: 'Lato', sans-serif;
          font-weight: 400;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          will-change: transform;
        }
        [data-splash-root] .panel-shape {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
        }
        [data-splash-root] .panel-label {
          position: relative;
          z-index: 2;
          pointer-events: none;
        }

        /* ===== ROW 1 ===== */
        [data-splash-root] .panel.idea {
          width: 100px;
          height: 100px;
          margin-top: -50px;
          margin-left: -100px;
          transform: translateX(50px);
          opacity: 0;
          z-index: 2;
          animation:
            unfoldSplashIdeaFadeIn 0.40s cubic-bezier(0.22, 0.61, 0.36, 1) 0.30s forwards,
            unfoldSplashIdeaSlide  0.45s cubic-bezier(0.33, 0.55, 0.5, 0.95) 1.00s forwards;
        }
        [data-splash-root] .panel.characters {
          width: 100px;
          height: 100px;
          margin-top: -50px;
          margin-left: -1px;
          transform: translateX(0);
          opacity: 0;
          z-index: 1;
          animation: unfoldSplashCharactersAppear 0s linear 0.70s forwards;
        }
        [data-splash-root] .panel.characters .panel-label {
          opacity: 0;
          animation: unfoldSplashFadeIn 0.25s cubic-bezier(0.25, 0.1, 0.25, 1) 1.45s forwards;
        }

        /* ===== ROW 2 ===== */
        [data-splash-root] .panel.row2 {
          width: 200px;
          height: 100px;
          margin-top: 0;
          margin-left: -100px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashRow2Appear 0s linear 1.45s forwards;
        }
        [data-splash-root] .panel.row2 .panel-label {
          position: absolute;
          top: 50%;
          color: #FFFFFF;
          opacity: 0;
          animation: unfoldSplashFadeIn 0.20s cubic-bezier(0.25, 0.1, 0.25, 1) 2.20s forwards;
        }
        [data-splash-root] .panel.row2 .label-story  { left: 25%; transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row2 .label-script { left: 75%; transform: translate(-50%, -50%); }

        /* ===== STEP 3: LEFT + RIGHT COLS ===== */
        [data-splash-root] .panel.col-right {
          width: 100px;
          height: 200px;
          margin-top: -100px;
          margin-left: 99px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashColAppear 0.28s cubic-bezier(0.33, 0.55, 0.5, 0.95) 2.50s forwards;
        }
        [data-splash-root] .panel.col-left {
          width: 100px;
          height: 200px;
          margin-top: -100px;
          margin-left: -200px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashColAppear 0.28s cubic-bezier(0.33, 0.55, 0.5, 0.95) 2.50s forwards;
        }
        [data-splash-root] .panel.col-left .panel-label,
        [data-splash-root] .panel.col-right .panel-label {
          position: absolute;
          left: 50%;
          color: #FFFFFF;
          opacity: 0;
          animation: unfoldSplashFadeIn 0.16s cubic-bezier(0.25, 0.1, 0.25, 1) 2.78s forwards;
        }
        [data-splash-root] .panel.col-left  .label-top    { top: 25%; transform: translate(-50%, -50%); }
        [data-splash-root] .panel.col-left  .label-bottom { top: 75%; transform: translate(-50%, -50%); }
        [data-splash-root] .panel.col-right .label-top    { top: 25%; transform: translate(-50%, -50%); }
        [data-splash-root] .panel.col-right .label-bottom { top: 75%; transform: translate(-50%, -50%); }

        /* ===== STEP 4: TOP + BOTTOM ROWS ===== */
        [data-splash-root] .panel.row3 {
          width: 400px;
          height: 100px;
          margin-top: 100px;
          margin-left: -200px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashColAppear 0.20s cubic-bezier(0.33, 0.55, 0.5, 0.95) 3.02s forwards;
        }
        [data-splash-root] .panel.row0 {
          width: 400px;
          height: 100px;
          margin-top: -200px;
          margin-left: -200px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashColAppear 0.20s cubic-bezier(0.33, 0.55, 0.5, 0.95) 3.02s forwards;
        }
        [data-splash-root] .panel.row0 .panel-label,
        [data-splash-root] .panel.row3 .panel-label {
          position: absolute;
          top: 50%;
          color: #FFFFFF;
          opacity: 0;
          animation: unfoldSplashFadeIn 0.12s cubic-bezier(0.25, 0.1, 0.25, 1) 3.22s forwards;
        }
        [data-splash-root] .panel.row0 .label-col1,
        [data-splash-root] .panel.row3 .label-col1 { left: 12.5%;  transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row0 .label-col2,
        [data-splash-root] .panel.row3 .label-col2 { left: 37.5%;  transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row0 .label-col3,
        [data-splash-root] .panel.row3 .label-col3 { left: 62.25%; transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row0 .label-col4,
        [data-splash-root] .panel.row3 .label-col4 { left: 87.25%; transform: translate(-50%, -50%); }

        /* ===== STEP 5: OUTER TOP + BOTTOM ROWS ===== */
        [data-splash-root] .panel.row-bot-outer {
          width: 400px;
          height: 100px;
          margin-top: 200px;
          margin-left: -200px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashColAppear 0.15s cubic-bezier(0.33, 0.55, 0.5, 0.95) 3.40s forwards;
        }
        [data-splash-root] .panel.row-top-outer {
          width: 400px;
          height: 100px;
          margin-top: -300px;
          margin-left: -200px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashColAppear 0.15s cubic-bezier(0.33, 0.55, 0.5, 0.95) 3.40s forwards;
        }
        [data-splash-root] .panel.row-top-outer .panel-label,
        [data-splash-root] .panel.row-bot-outer .panel-label {
          position: absolute;
          top: 50%;
          color: #FFFFFF;
          opacity: 0;
          animation: unfoldSplashFadeIn 0.10s cubic-bezier(0.25, 0.1, 0.25, 1) 3.55s forwards;
        }
        [data-splash-root] .panel.row-top-outer .label-col1,
        [data-splash-root] .panel.row-bot-outer .label-col1 { left: 12.5%;  transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row-top-outer .label-col2,
        [data-splash-root] .panel.row-bot-outer .label-col2 { left: 37.5%;  transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row-top-outer .label-col3,
        [data-splash-root] .panel.row-bot-outer .label-col3 { left: 62.25%; transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row-top-outer .label-col4,
        [data-splash-root] .panel.row-bot-outer .label-col4 { left: 87.25%; transform: translate(-50%, -50%); }

        /* ===== STEP 6: OUTERMOST TOP + BOTTOM ROWS ===== */
        [data-splash-root] .panel.row-bot-outer2 {
          width: 400px;
          height: 100px;
          margin-top: 300px;
          margin-left: -200px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashColAppear 0.12s cubic-bezier(0.33, 0.55, 0.5, 0.95) 3.69s forwards;
        }
        [data-splash-root] .panel.row-top-outer2 {
          width: 400px;
          height: 100px;
          margin-top: -400px;
          margin-left: -200px;
          display: block;
          opacity: 0;
          z-index: 0;
          animation: unfoldSplashColAppear 0.12s cubic-bezier(0.33, 0.55, 0.5, 0.95) 3.69s forwards;
        }
        [data-splash-root] .panel.row-top-outer2 .panel-label,
        [data-splash-root] .panel.row-bot-outer2 .panel-label {
          position: absolute;
          top: 50%;
          color: #FFFFFF;
          opacity: 0;
          animation: unfoldSplashFadeIn 0.08s cubic-bezier(0.25, 0.1, 0.25, 1) 3.81s forwards;
        }
        [data-splash-root] .panel.row-top-outer2 .label-col1,
        [data-splash-root] .panel.row-bot-outer2 .label-col1 { left: 12.5%;  transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row-top-outer2 .label-col2,
        [data-splash-root] .panel.row-bot-outer2 .label-col2 { left: 37.5%;  transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row-top-outer2 .label-col3,
        [data-splash-root] .panel.row-bot-outer2 .label-col3 { left: 62.25%; transform: translate(-50%, -50%); }
        [data-splash-root] .panel.row-top-outer2 .label-col4,
        [data-splash-root] .panel.row-bot-outer2 .label-col4 { left: 87.25%; transform: translate(-50%, -50%); }

        /* ===== Keyframes (namespaced to avoid colliding with app CSS) ===== */
        @keyframes unfoldSplashIdeaFadeIn       { to { opacity: 1; } }
        @keyframes unfoldSplashIdeaSlide        { to { transform: translateX(0); } }
        @keyframes unfoldSplashCharactersAppear { to { opacity: 1; } }
        @keyframes unfoldSplashRow2Appear       { to { opacity: 1; } }
        @keyframes unfoldSplashColAppear        { to { opacity: 1; } }
        @keyframes unfoldSplashFadeIn           { to { opacity: 1; } }
        @keyframes unfoldSplashStageFadeOut     { to { opacity: 0; } }
        @keyframes unfoldSplashLogoFadeIn       { to { opacity: 1; } }
        @keyframes unfoldSplashRow1SlideUp      { to { transform: translateY(-50px); } }
      `}</style>
    </div>
  );
}
