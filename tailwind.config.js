/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      /* ============================================ */
      /* ============ COLORS ======================= */
      /* ============================================ */
      colors: {
        bg:             "var(--bg)",              // #ffffff
        "bg-secondary": "var(--bg-secondary)",    // #f7f7f8
        surface:        "var(--surface)",          // #ffffff
        border:         "var(--border)",           // rgba(0,0,0,0.07)
        "border-strong":"var(--border-strong)",    // rgba(0,0,0,0.14)
        "border-ddd":   "var(--border-ddd)",       // #DDDDDD
        ink:            "var(--ink)",              // #000000
        "ink-soft":     "var(--ink-soft)",         // #3c3c43
        "ink-mute":     "var(--ink-mute)",         // #8e8e93
        "ink-ghost":    "var(--ink-ghost)",         // #c7c7cc
        record:         "var(--record)",           // #FF3B30
        progress:       "var(--progress)",         // #000000
        sync:           "var(--sync)",             // #e67e22
        "sync-bg":      "var(--sync-bg)",          // #fef9f0
        "sync-border":  "var(--sync-border)",      // #f5e6cc
      },

      /* ============================================ */
      /* ============ TYPOGRAPHY =================== */
      /* ============================================ */
      fontFamily: {
        sans: ["'Lato'", "-apple-system", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs":     ["9px",  {}],
        "xs":      ["10px", {}],
        "caption": ["11px", { lineHeight: "1.35" }],
        "sm":      ["12px", { lineHeight: "1.35" }],
        "base":    ["13px", { lineHeight: "1.55" }],
        "md":      ["14px", { lineHeight: "1.45" }],
        "body":    ["15px", { lineHeight: "1.45" }],
        "input":   ["16px", {}],
        "lg":      ["17px", {}],
        "xl":      ["18px", {}],
        "2xl":     ["20px", {}],
        "3xl":     ["22px", { letterSpacing: "-0.025em" }],
        "4xl":     ["32px", {}],
        "display": ["35px", { lineHeight: "1.08", letterSpacing: "-0.035em" }],
      },
      fontWeight: {
        light:    "300",
        normal:   "400",
        medium:   "500",
        semibold: "600",
        bold:     "700",
        black:    "900",
      },
      letterSpacing: {
        tighter:  "-0.035em",
        tight:    "-0.025em",
        snug:     "-0.01em",
        normal:   "0",
        wide:     "0.02em",
        wider:    "0.06em",
        widest:   "0.1em",
      },

      /* ============================================ */
      /* ============ SHAPE & SPACE ================ */
      /* ============================================ */
      borderRadius: {
        "sm":      "10px",
        DEFAULT:   "12px",
        "md":      "14px",
        "lg":      "16px",
        "xl":      "18px",
        "2xl":     "20px",
        "3xl":     "24px",
        "full":    "999px",
      },
      maxWidth: {
        app: "520px",
      },

      /* ============================================ */
      /* ============ EFFECTS ====================== */
      /* ============================================ */
      boxShadow: {
        card: "var(--card-shadow)",
        fab:  "0 2px 12px rgba(0,0,0,0.08)",
        drag: "0 16px 50px rgba(0,0,0,0.22), 0 4px 14px rgba(0,0,0,0.12)",
      },
      transitionTimingFunction: {
        app: "var(--ease)",
      },
    },
  },
  plugins: [],
};
