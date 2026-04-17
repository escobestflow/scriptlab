// Input + Textarea primitives.
// Two sizes:
//   - "standard" — full-sized `.field`-style input (character name, title, search, etc.)
//   - "compact"  — smaller variant for layer attribute fields (logline, etc.)
//                  When a compact input is blurred AND filled, its chrome fades
//                  out so the text reads inline with surrounding copy.
//
// Styles live in globals.css under `.ds-input*`.

import {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  forwardRef,
} from "react";

export type InputSize = "standard" | "compact";

// Native `<input size>` is numeric — we shadow it with our variant name.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: InputSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "standard", className = "", ...rest },
  ref
) {
  const cls = ["ds-input", `ds-input-${size}`, className].filter(Boolean).join(" ");
  return <input ref={ref} className={cls} {...rest} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: InputSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size = "standard", className = "", ...rest },
  ref
) {
  const cls = [
    "ds-input",
    "ds-input-textarea",
    `ds-input-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <textarea ref={ref} className={cls} {...rest} />;
});
