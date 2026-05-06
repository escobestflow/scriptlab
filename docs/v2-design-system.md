# V2 Design System

Semantic-token design system, scoped to v2. All v2 work uses these
tokens — never raw hex codes, never raw font-size literals. When a
new design surface needs a token that doesn't exist, add it here
and to the CSS rather than hardcoding.

Source of truth for the CSS rules:
[`app/globals.css`](../app/globals.css) — search for the
`V2 Design System tokens` section near the bottom.

Activation: tokens only apply when `<html data-design="v2">`. The
flag is set by `lib/auth.tsx`'s `applyDesignForEmail` based on
`NEXT_PUBLIC_V2_EMAILS`.

---

## How to use

**Type tokens** are utility classes — apply directly in JSX:
```tsx
<div className="ds-type-tab-header">Projects</div>
<button className="ds-type-button-label">Create</button>
```

**Color tokens** are CSS variables — reference inside `html[data-design="v2"]`-scoped rules:
```css
html[data-design="v2"] .my-card {
  background: var(--ds-color-gray-fill);
  color: var(--ds-color-black);
  border: 1px solid var(--ds-color-gray-outline);
}
```

Inline styles in JSX should use the same vars:
```tsx
<div style={{ color: "var(--ds-color-unfold-gold)" }}>...</div>
```

---

## Breakpoint

Mobile → desktop flips at **1440px**. Matches the existing layout
breakpoint (sidebar appears at 1440+). Below 1440 = mobile token
values, ≥ 1440 = desktop overrides.

---

## Type tokens

Mobile-first. The mobile column is the base; the desktop column
shows what changes (only listed properties are overridden).

Font weight names: Roman/Regular = 400, Medium = 500, Semi-bold = 600,
Bold = 700, Black = 900. "Auto" line-height = `normal`.
Letter-spacing percentages → em (3% = 0.03em).

### Display (Poynter Oldstyle Display)

| Class | Mobile | Desktop |
|---|---|---|
| `ds-type-tab-header` | 39 / 400 / 0.03em | 50 |
| `ds-type-project-page-title` | 20 / 400 / 0 | 65 |
| `ds-type-project-card-title` | 20 / 400 / 0 | 24 |
| `ds-type-empty` | 34 / 400 / 0 / lh 37px | 44 (lh stays 37) |

### UI (Lato)

| Class | Mobile | Desktop |
|---|---|---|
| `ds-type-project-card-pill-label` | 8 / 700 / 0.03em / UPPER | 10 |
| `ds-type-main-tab-nav-active` | 8 / 900 / 0.07em / UPPER | 14 / 700 / 0 / case-as-typed |
| `ds-type-main-tab-nav-inactive` | 14 / 500 / 0.07em / UPPER | 14 / 400 / 0 / case-as-typed |
| `ds-type-project-tab-nav-active` | 7 / 700 / 0.07em / UPPER | 12 / 0.09em |
| `ds-type-project-tab-nav-inactive` | 7 / 500 / 0.07em / UPPER | 12 / 0.09em |
| `ds-type-attribute-title` | 13 / 600 / 0 | (same) |
| `ds-type-body` | 13 / 400 / 0 | (same) |
| `ds-type-selected-option-label` | 9 / 500 / 0.03em / UPPER | (same) |
| `ds-type-button-label` | 12 / 400 / 0.07em / UPPER | (same) |

`UPPER` = `text-transform: uppercase`.

---

## Color tokens

| Var | Hex |
|---|---|
| `--ds-color-black` | `#000000` |
| `--ds-color-white` | `#FFFFFF` |
| `--ds-color-unfold-gold` | `#AC9175` |
| `--ds-color-ai-yellow` | `#FFD60A` |
| `--ds-color-gray-fill` | `#FBF9F9` |
| `--ds-color-gray-outline` | `#E4E3E4` |
| `--ds-color-gray-chip-outline` | `#EDEDED` |
| `--ds-color-gray-chip-fill` | `#F4F4F4` |
| `--ds-color-gray-chip-label` | `#888888` |
| `--ds-color-gray-dark-fill` | `#626262` |
| `--ds-color-accent-green-on-dark` | `#8CC1AE` |
| `--ds-color-accent-green-on-light` | `#D8EEE8` |
| `--ds-color-accent-red-on-dark` | `#F2B5B5` |
| `--ds-color-accent-red-on-light` | `#F6D5D1` |
| `--ds-color-accent-blue-on-dark` | `#9EC2DA` |
| `--ds-color-accent-blue-on-light` | `#C7E1F4` |
| `--ds-color-accent-yellow-on-dark` | `#E8E69C` |
| `--ds-color-accent-yellow-on-light` | `#F5F0CB` |
| `--ds-color-accent-purple-on-dark` | `#9EA0DA` |
| `--ds-color-accent-purple-on-light` | `#D9D8EE` |
| `--ds-color-accent-orange-on-dark` | `#D8AF6D` |
| `--ds-color-accent-orange-on-light` | `#F6E8D1` |

Accent pairs: `on-dark` is the saturated swatch for dark surfaces;
`on-light` is the soft tint for light surfaces. Pick the one that
matches the surface, not the content.

---

## Font sourcing — Poynter Oldstyle Display

**Status: not yet wired up.** The display font stack falls back to
Georgia / Times / serif until the actual font files are loaded.

To wire it up, three options:
1. **Adobe Fonts** (Typekit). Add the kit `<link>` to
   `app/layout.tsx`'s `<head>`.
2. **Cloud.typography** (Hoefler & Co.). Same — `<link>` in head.
3. **Self-host**. Drop `.woff2` files in `public/fonts/`, add an
   `@font-face` declaration in `globals.css` matching the
   `--ds-font-display` family name.

Whichever path, the `font-family` string in `--ds-font-display`
already references `"Poynter Oldstyle Display"` — once the font is
loaded under that family name it picks up automatically, no other
code changes required.

---

## Open questions / known issues

1. **Two tokens spec'd as `type-project-page-title`** (sizes 65 and 24
   on desktop). Provisionally renamed the smaller one
   `type-project-card-title`. Confirm or rename.

2. **Mobile `type-main-tab-nav-inactive` is size 14, active is size 8**
   — that's flipped from typical (active usually larger/bolder than
   inactive). Preserved as written; flag if typo.

3. **`color-ai-yellow` value was `£FFD60A`** in source — assumed
   typo, treated as `#FFD60A`. Confirm.

4. **`type-button label` had a space** in the spec (between "button"
   and "label") — used `ds-type-button-label` (hyphenated) for the
   class name since CSS classes can't contain spaces.

---

## Workflow when redesigning a screen

1. User provides a screenshot (mobile and/or desktop).
2. I find the existing JSX/CSS for that surface.
3. I add v2 overrides scoped under `html[data-design="v2"]`:
   - Type → swap inline styles / classes for `ds-type-*` utility classes.
   - Color → swap hex codes / inherited colors for `var(--ds-color-*)`.
   - Layout adjustments (padding, gap, radius, etc.) get raw values
     unless we add layout tokens later.
4. v1 stays untouched — only v2 viewers see the change.
5. Verify in preview at both mobile (≤ 1439px) and desktop (≥ 1440px)
   widths.
