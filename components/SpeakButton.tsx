// Small ▶/⏸ button that reads text aloud.
//
// Two modes:
//   - default (single voice, narrator tone): pass `text`.
//   - script (multi-voice screenplay read):  pass `mode="script"` + `characters`.
//
// Only one SpeakButton in the whole app plays at a time. Starting one stops
// any other that was playing.

"use client";

import { useEffect, useRef, useState } from "react";
import type { Character, Genre, ProjectType } from "@/lib/story";
import { playback, speak, speakScript, stopSpeaking } from "@/lib/tts";

type Size = "sm" | "md";

interface CommonProps {
  size?: Size;
  projectType?: ProjectType;
  genres?: Genre[];
  title?: string;
  /** Extra className merged onto the root button. */
  className?: string;
}

type Props =
  | (CommonProps & { text: string; mode?: "text" })
  | (CommonProps & { text: string; mode: "script"; characters: Character[] });

export function SpeakButton(props: Props) {
  const { size = "sm", title, className = "" } = props;
  const ownerRef = useRef<symbol>(Symbol("speakbtn"));
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = playback.subscribe(owner => {
      const mine = owner === ownerRef.current;
      setActive(mine);
      if (!mine) setLoading(false);
    });
    // Reflect any already-active state (e.g. remount mid-play)
    setActive(playback.getActiveOwner() === ownerRef.current);
    return unsub;
  }, []);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (active || loading) {
      stopSpeaking();
      setLoading(false);
      return;
    }
    const text = props.text?.trim();
    if (!text) return;
    setLoading(true);
    try {
      if (props.mode === "script") {
        await speakScript(text, props.characters, ownerRef.current, {
          projectType: props.projectType,
          genres: props.genres,
        });
      } else {
        await speak(text, ownerRef.current, {
          projectType: props.projectType,
          genres: props.genres,
        });
      }
    } catch (err) {
      console.error("speak failed", err);
    } finally {
      setLoading(false);
    }
  }

  const cls = [
    "speak-btn",
    `speak-btn-${size}`,
    active ? "is-playing" : "",
    loading ? "is-loading" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cls}
      onClick={handleClick}
      aria-label={active ? "Stop reading" : "Read aloud"}
      title={title ?? (active ? "Stop" : "Read aloud")}
    >
      {active ? <PauseIcon /> : loading ? <SpinnerIcon /> : <PlayIcon />}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
      <polygon points="7,4 20,12 7,20" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" className="speak-btn-spinner" aria-hidden="true">
      <circle
        cx="12" cy="12" r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeDasharray="14 14"
        strokeLinecap="round"
      />
    </svg>
  );
}
