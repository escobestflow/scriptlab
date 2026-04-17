// Button primitive.
// Single source of truth for every app button. Tweak the CSS token
// (`.ds-btn*` in globals.css) and every usage picks it up automatically.

import { ButtonHTMLAttributes, ReactNode, forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "lg" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional leading icon (rendered to the left of the label). */
  icon?: ReactNode;
  /** If true, stretches to fill its container's width. */
  block?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "lg", icon, block = false, className = "", children, type, ...rest },
  ref
) {
  const cls = [
    "ds-btn",
    `ds-btn-${variant}`,
    `ds-btn-${size}`,
    block ? "ds-btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} className={cls} type={type ?? "button"} {...rest}>
      {icon != null && <span className="ds-btn-icon" aria-hidden="true">{icon}</span>}
      <span className="ds-btn-label">{children}</span>
    </button>
  );
});
