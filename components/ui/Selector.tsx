// Selector (chip) primitive.
// Single source of truth for every multi/single-select chip. Used for genre,
// tone, theme, ending type, character archetype, moment type, etc.
//
// Styles live in globals.css under `.ds-selector`.

import { ButtonHTMLAttributes, ReactNode, forwardRef } from "react";

export interface SelectorProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this chip is currently selected. */
  selected?: boolean;
  children?: ReactNode;
}

export const Selector = forwardRef<HTMLButtonElement, SelectorProps>(function Selector(
  { selected = false, className = "", children, type, ...rest },
  ref
) {
  const cls = ["ds-selector", selected ? "is-selected" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      className={cls}
      type={type ?? "button"}
      aria-pressed={selected}
      {...rest}
    >
      {children}
    </button>
  );
});
