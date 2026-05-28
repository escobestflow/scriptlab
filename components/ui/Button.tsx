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
  /** Extra class(es) appended to the inner `.ds-btn-label` span.
   *  Use this to apply a design-system type token (e.g.
   *  `ds-type-button-label`) where the surrounding context's
   *  typography rules would otherwise win — the token on the span
   *  beats inheritance from the button element. */
  labelClassName?: string;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "lg", icon, block = false, className = "", labelClassName = "", children, type, ...rest },
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

  const labelCls = ["ds-btn-label", labelClassName].filter(Boolean).join(" ");

  return (
    <button ref={ref} className={cls} type={type ?? "button"} {...rest}>
      {icon != null && <span className="ds-btn-icon" aria-hidden="true">{icon}</span>}
      <span className={labelCls}>{children}</span>
    </button>
  );
});
