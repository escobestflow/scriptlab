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
| `ds-type-empty-header` | 34 / 400 / 0 / lh 1 | (same) |
| `ds-type-project-page-title-empty` | 25 / 400 / -0.03em / lh 29px | 50 / 400 / -0.03em / lh auto |

### UI (Lato)

| Class | Mobile | Desktop |
|---|---|---|
| `ds-type-project-card-pill-label` | 8 / 700 / 0.03em / UPPER | 10 |
| `ds-type-main-tab-nav-active` | 8 / 900 / 0.07em / UPPER | 14 / 700 / 0 / case-as-typed |
| `ds-type-main-tab-nav-inactive` | 8 / 500 / 0.07em / UPPER | 14 / 400 / 0 / case-as-typed |
| `ds-type-project-tab-nav-active` | 7 / 700 / 0.07em / UPPER | 12 / 0.09em |
| `ds-type-project-tab-nav-inactive` | 7 / 500 / 0.07em / UPPER | 12 / 0.09em |
| `ds-type-attribute-title` | 13 / 600 / 0 | (same) |
| `ds-type-body` | 13 / 400 / 0 / lh 18px | (same) |
| `ds-type-body-bold` | 13 / 700 / 0 | (same) |
| `ds-type-int-header` | 11 / 700 / 0.09em / UPPER | (same) |
| `ds-type-body-sm` | 10 / 400 / 0.03em / lh 14px | 11 / 400 / 0.03em / lh auto |
| `ds-type-cta` | 9 / 500 / 0.08em / UPPER | 11 / 500 / 0.08em / UPPER |
| `ds-type-selected-option-label` | 9 / 500 / 0.03em / UPPER | (same) |
| `ds-type-button-label` | 12 / 400 / 0.07em / UPPER | (same) |
| `ds-type-draft-dropdown` | 10 / 500 / 0.03em / case-as-typed | 11 / 500 / 0.09em / UPPER |

`UPPER` = `text-transform: uppercase`.

---

## Color tokens

| Var | Hex | Notes |
|---|---|---|
| `--ds-color-black` | `#000000` | |
| `--ds-color-white` | `#FFFFFF` | |
| `--ds-color-unfold-gold` | `#AC9175` | |
| `--ds-color-ai-yellow` | `#FFD60A` | |
| `--ds-color-app-background` | `#F8F7F7` | Painted on `body` at viewports < 1440px. Desktop value TBD. |
| `--ds-color-record-red` | `#CE2D1E` | Record button fill. |
| `--ds-color-gray-lightest` | `#FCFBFB` | Search bar fill, filter pill fill. |
| `--ds-color-gray-fill` | `#FBF9F9` | |
| `--ds-color-gray-outline` | `#E4E3E4` | |
| `--ds-color-gray-chip-outline` | `#EDEDED` | |
| `--ds-color-gray-chip-fill` | `#F4F4F4` | |
| `--ds-color-gray-chip-label` | `#888888` | |
| `--ds-color-gray-dark-fill` | `#626262` | |
| `--ds-color-accent-green-on-dark` | `#8CC1AE` | |
| `--ds-color-accent-green-on-light` | `#D8EEE8` | |
| `--ds-color-accent-red-on-dark` | `#F2B5B5` | |
| `--ds-color-accent-red-on-light` | `#F6D5D1` | |
| `--ds-color-accent-blue-on-dark` | `#9EC2DA` | |
| `--ds-color-accent-blue-on-light` | `#C7E1F4` | |
| `--ds-color-accent-yellow-on-dark` | `#E8E69C` | |
| `--ds-color-accent-yellow-on-light` | `#F5F0CB` | |
| `--ds-color-accent-purple-on-dark` | `#9EA0DA` | |
| `--ds-color-accent-purple-on-light` | `#D9D8EE` | |
| `--ds-color-accent-orange-on-dark` | `#D8AF6D` | |
| `--ds-color-accent-orange-on-light` | `#F6E8D1` | |

Accent pairs: `on-dark` is the saturated swatch for dark surfaces;
`on-light` is the soft tint for light surfaces. Pick the one that
matches the surface, not the content.

---

## Font sourcing — Poynter Oldstyle Display

**Status: wired up, self-hosted.** Files live in `/public/fonts/`,
served from the same origin. `@font-face` declarations are at the
top of `globals.css` (search for "V2 Design System fonts").

### Registered families

| Family name | Available weights | Files |
|---|---|---|
| `Poynter Oldstyle Display` | 400 (Roman), 600 (Semibold) | `PoynterOSDisp-Roman.ttf`, `PoynterOSDisp-Semibold.ttf` |
| `Poynter Oldstyle Display Condensed` | 400, 600, 700 | `PoynterOSDispCond-{Roman,Semibold,Bold}.ttf` |
| `Poynter Oldstyle Display Narrow` | 600, 700 | `PoynterOSDispNarrow-{Semibold,Bold}.ttf` |

### CSS variables

| Var | Family |
|---|---|
| `--ds-font-display` | Default width — used by every current display token |
| `--ds-font-display-condensed` | Condensed — for tokens that need tighter horizontal rhythm |
| `--ds-font-display-narrow` | Narrow — for the tightest cut |

To use the Condensed or Narrow widths, override `font-family` on a
specific element or define a new utility class:
```css
html[data-design="v2"] .ds-type-some-tight-headline {
  font-family: var(--ds-font-display-condensed);
  font-weight: 600;
  /* ... */
}
```

### File-format note

Files are `.ttf` (~50KB each). `.woff2` would be ~30% smaller — if
the Font Bureau license includes web formats, it's worth swapping.
Until then, `.ttf` is fine; browsers cache aggressively and only
fetch faces actually used on the page.

---

## Components

Live demos at `/style-guide`. The classes below are the source of
truth; reuse them rather than inventing parallel rules in JSX.

### Chips & buttons

| Class | Notes |
|---|---|
| `ai-wand` | 27x27 paired-bolt chip. Per-field AI generate trigger. Glyph: `/icon-ai-button.svg`. |
| `add-all-characters-chip` / `add-all-scenes-chip` | Labeled AI chips for layer-bar bulk actions. Same fill / stroke / shadow as `.ai-wand`. |
| `v2-empty-state-toggle` | Dev-only toggle below the topbar `+` button. Flips Projects/Ideas into their empty-state UI without deleting data. |
| `scene-popup-script-cta` | Full-width "Script Scene" primary CTA shown in the scene popup when opened from the Script tab on an unwritten beat. |

### Cards & rows

| Class | Notes |
|---|---|
| `card.v2-character-card` | Characters-tab row. 122-tall, 100x120 portrait flush left, role pill in accent color, options glyph absolute top-right. |
| `v2-character-role-pill` + `v2-character-role-{protagonist\|antagonist\|...}` | Role pill with per-role accent fill. |
| `v2-beat-row` + `v2-beat-card` | Story-tab scene row. 103-tall, 101x72 thumb left, ds-type-body-bold title + ds-type-body summary right. |
| `v2-beat-number-col` + `v2-beat-number-badge` | 21x21 outlined number badge with dotted timeline connector. Used by Story tab. |
| `v2-script-card` | Script-tab scene row. 32x32 badge INSIDE card top-left, ds-type-int-header slug, ds-type-project-card-title title, ds-type-body summary, footer with page-range + per-scene chip. |
| `v2-script-number-badge` | 32x32 number badge for Script tab. Lives inside the card. Written state inverts to black fill. |
| `v2-script-scripted-flag` | "✓ Scripted" indicator that replaces the per-row chip once a beat is written. |

### Attribute rows

| Class | Notes |
|---|---|
| `attr-row-inline-input` + `attr-inline-text-input` | Single-line text fields that sit inline with the row label rather than collapsing below. Used by Concept Title, Character Name, Character Age, Scene Name. |

### Sheets

| Class | Notes |
|---|---|
| `scene-popup-scrim` + `scene-popup-card` | Scene preview popup. Variant via `.scene-popup-variant-{story\|script-unwritten}` modifier — Story variant is bottom-anchored 180px from viewport bottom; Script-unwritten variant is vertically centered. |
| `script-view-sheet` | Per-scene script reader/editor sheet. Renders ALL written scenes stacked in one scroll port; header updates live based on most-visible scene via IntersectionObserver. Pencil toggles inline highlight mode + AI rewrite composer (ported from `read-through-sheet`). |
| `easy-direction-sheet` | "Shape your story" sheet shown after Easy mode + Finish. Direction textarea + Type-filter idea picker. |
| Pull-to-close | Global gesture wired in `app/page.tsx` — drag any `.sheet.open` or `.create-modal.open` within the top 80px down past ~22% of sheet height to dismiss. Clicks the paired backdrop so existing close handlers fire. |

### Icons

| File | Use |
|---|---|
| `/icon-ai-button.svg` | Paired-bolt glyph for AI generate / regenerate actions. |
| `/icon-script-sml.svg` | 10.86x11.27 script icon for the View Script chip on written rows. |
| `/icon-options.svg` | 13x3 three-dot more-actions glyph. Card-corner menu. |
| `/icon-row-move.svg` | 6x14 grip glyph for draggable rows. |
| `/icon-duration.svg` | Clock glyph for scene-duration tag. |
| `/icon-add-cta.svg` | Plus glyph for primary add buttons. |

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
