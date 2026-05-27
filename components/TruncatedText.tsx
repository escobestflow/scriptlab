"use client";

// Wrapper that shows a hover tooltip with the full text whenever the
// underlying element is visually truncated. Tooltip stays out of the way
// when there's no truncation — checked via scrollWidth/scrollHeight vs
// clientWidth/clientHeight, re-measured on resize.
//
// Usage (drop-in replacement for a div/span/h3 that uses CSS truncation):
//
//   <TruncatedText className="project-title" as="h3">
//     {story.title}
//   </TruncatedText>
//
// When children isn't a plain string, pass `text` so the tooltip knows
// what to display:
//
//   <TruncatedText className="logline" text={c.logline}>
//     {c.logline || "No logline yet"}
//   </TruncatedText>

import {
  useEffect, useLayoutEffect, useRef, useState,
  type ElementType, type HTMLAttributes, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface TruncatedTextProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  children: ReactNode;
  /** Plain-text version for the tooltip. If omitted and children is a
   *  string, that string is used. Always pass this explicitly when
   *  children includes JSX so the tooltip reads cleanly. */
  text?: string;
  /** HTML tag to render. Defaults to "div" — pick whatever matches the
   *  semantic role of the original element you're replacing (h3 for a
   *  card title, span for an inline pill, etc.). */
  as?: ElementType;
  /** When true, skip the truncation check and always show the tooltip
   *  on hover. Useful for spots where the text is pre-truncated in JS
   *  (e.g. `.slice(0, 60) + "…"`) so the scroll-vs-client comparison
   *  always reports "fits". */
  forceTooltip?: boolean;
}

export default function TruncatedText({
  children,
  text,
  as: Tag = "div",
  forceTooltip = false,
  className,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: TruncatedTextProps) {
  // Single ref retypes per tag — keep it loose so it can attach to any
  // HTML element the caller passes via `as`.
  const ref = useRef<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; flipUp: boolean } | null>(null);

  // Truncation detection: any overflow on either axis counts. Re-runs
  // when text content changes AND when the element resizes (ResizeObserver
  // covers both window resize and layout shifts in the parent card).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const isTruncated =
        el.scrollWidth > el.clientWidth + 1 || // +1 for sub-pixel rounding
        el.scrollHeight > el.clientHeight + 1;
      setTruncated(isTruncated);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-measure if the text content changes.
  }, [children, text]);

  // Tooltip position: anchored to the element's bottom-left, with
  // viewport-flip when there's no room below. Recomputed on every
  // mouse-enter so a scrolled-card always pins correctly.
  function handleEnter(e: React.MouseEvent<HTMLElement>) {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const tooltipMaxHeight = 200; // matches CSS max-height for the flip math
      const spaceBelow = window.innerHeight - r.bottom;
      const flipUp = spaceBelow < tooltipMaxHeight && r.top > tooltipMaxHeight;
      setPos({
        left: r.left,
        top: flipUp ? r.top - 6 : r.bottom + 6,
        flipUp,
      });
    }
    setHovering(true);
    onMouseEnter?.(e);
  }

  function handleLeave(e: React.MouseEvent<HTMLElement>) {
    setHovering(false);
    onMouseLeave?.(e);
  }

  const tooltipText =
    text ?? (typeof children === "string" ? children : "");

  const showTooltip =
    (truncated || forceTooltip) && hovering && pos && tooltipText.trim().length > 0;

  // Cast through `any` for the ref because TS can't reconcile a generic
  // `ElementType` with a single ref type — runtime works for every
  // standard tag we pass.
  return (
    <>
      <Tag
        ref={ref as any}
        className={className}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        {...rest}
      >
        {children}
      </Tag>
      {showTooltip && typeof document !== "undefined" && createPortal(
        <div
          className="truncate-tooltip"
          role="tooltip"
          style={{
            position: "fixed",
            left: pos!.left,
            top: pos!.top,
            transform: pos!.flipUp ? "translateY(-100%)" : undefined,
            zIndex: 9999,
          }}
        >
          {tooltipText}
        </div>,
        document.body,
      )}
    </>
  );
}
