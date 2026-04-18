// Input + Textarea primitives.
// Two sizes:
//   - "standard" — full-sized `.field`-style input (character name, title, search, etc.)
//   - "compact"  — smaller variant for layer attribute fields (logline, etc.)
//                  When a compact input is blurred AND filled, its chrome fades
//                  out so the text reads inline with surrounding copy.
//
// Built-in clear button: when the field has a string value, a small ✕
// appears on the right side of the field. Tapping it clears the value
// by dispatching a native input event, which React's synthetic event
// system captures and forwards to the parent's onChange. Callers don't
// need to thread any extra prop — they get it for free. Set
// `showClear={false}` to opt out on a specific field.
//
// Styles live in globals.css under `.ds-input*`.

import {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  forwardRef,
  useRef,
  useImperativeHandle,
} from "react";

export type InputSize = "standard" | "compact";

// Dispatch a native input event that React will pick up as an onChange.
// Uses the prototype setter so React's internal "last value" tracker
// sees the change and actually fires the handler.
function nativeSetValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Native `<input size>` is numeric — we shadow it with our variant name.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: InputSize;
  /** Hide the built-in clear button even when the field has content. */
  showClear?: boolean;
  /** Called after the field is cleared (in addition to the synthetic
   *  onChange). Useful for callers that do extra bookkeeping on clear. */
  onClear?: () => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "standard", className = "", showClear = true, onClear, value, style, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

  const hasValue = typeof value === "string" && value.length > 0;
  const showX = showClear && hasValue && !rest.disabled && !rest.readOnly;

  const cls = [
    "ds-input",
    `ds-input-${size}`,
    showX ? "ds-input-has-clear" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // `style` on the Input was historically applied to the raw element.
  // Now that the component renders a wrapper span, we forward any
  // layout-affecting style (width, flex, margin, etc.) to the wrapper
  // so existing callsites like `style={{ flex: 1 }}` keep working.
  return (
    <span className="ds-input-wrap" style={style}>
      <input ref={innerRef} className={cls} value={value} {...rest} />
      {showX && (
        <button
          type="button"
          className="ds-input-clear"
          aria-label="Clear input"
          // Prevent the input from losing focus on mousedown so the
          // clear interaction feels tight and keyboard focus stays put.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const el = innerRef.current;
            if (el) nativeSetValue(el, "");
            onClear?.();
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </span>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: InputSize;
  showClear?: boolean;
  onClear?: () => void;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size = "standard", className = "", showClear = true, onClear, value, style, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

  const hasValue = typeof value === "string" && value.length > 0;
  const showX = showClear && hasValue && !rest.disabled && !rest.readOnly;

  const cls = [
    "ds-input",
    "ds-input-textarea",
    `ds-input-${size}`,
    showX ? "ds-input-has-clear" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="ds-input-wrap ds-input-wrap-textarea" style={style}>
      <textarea ref={innerRef} className={cls} value={value} {...rest} />
      {showX && (
        <button
          type="button"
          className="ds-input-clear ds-input-clear-textarea"
          aria-label="Clear textarea"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const el = innerRef.current;
            if (el) nativeSetValue(el, "");
            onClear?.();
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </span>
  );
});
