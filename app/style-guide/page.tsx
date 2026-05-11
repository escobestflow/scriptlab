"use client";

// V2 Style Guide — single-page reference for every type token, color
// token, and redesigned component. Eats its own dog food: the page
// itself uses the v2 tokens it documents.
//
// Layout philosophy: a flat vertical stack, no nested cards or demo
// frames. Each entry is the live sample at its true visual weight,
// followed by metadata in fine print. Tokens within each section are
// sorted biggest → smallest so the eye reads the system top-down.
//
// Gated to v2 viewers via useIsV2(). Forces data-design="v2" on
// mount regardless of the global flag so the guide renders correctly
// even if the viewer isn't on the v2 list (preview / debugging).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useIsV2 } from "@/lib/v2Access";

/* ─────────────────────────────────────────────────────────────────
   Copy-to-clipboard chip — appears at the right of every token /
   component label so we can refer to a piece of the design system
   by its exact id when iterating. Hit target is 44x44 via an
   `::before` pseudo-element that extends past the visible 32x32
   bounds, satisfying the WCAG 2.5.5 / Apple HIG minimum without
   bloating the layout.
   ───────────────────────────────────────────────────────────────── */

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    try {
      // navigator.clipboard is the modern path; falls back to a
      // textarea + execCommand on older Safari builds the style
      // guide may be opened on.
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = id;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* swallow — silent failure is fine for a dev page */
    }
  }
  return (
    <button
      type="button"
      className={`sg-copy-btn${copied ? " is-copied" : ""}`}
      onClick={handleCopy}
      aria-label={copied ? `Copied ${id}` : `Copy ${id}`}
      title={copied ? "Copied!" : `Copy "${id}"`}
    >
      {copied ? (
        // Check glyph — 1.8 stroke matches the rest of the SVG iconry
        // in this page (back arrow uses the same metrics).
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        // Standard "copy" icon — back square + front square stacked.
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  );
}

export default function StyleGuidePage() {
  const { user, loading } = useAuth();
  const isV2 = useIsV2();

  useEffect(() => {
    const prev = document.documentElement.dataset.design;
    document.documentElement.dataset.design = "v2";
    return () => {
      if (prev) document.documentElement.dataset.design = prev;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user || !isV2) {
      if (typeof window !== "undefined") window.location.href = "/";
    }
  }, [loading, user, isV2]);

  return (
    <div className="sg-page">
      <header className="sg-topbar">
        <Link href="/" className="sg-back" aria-label="Back to app">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          <span>Back</span>
        </Link>
      </header>

      <main className="sg-stack">
        <section className="sg-hero-block">
          <div className="sg-eyebrow">Design</div>
          <h1 className="sg-h1">Style Guide</h1>
          <p className="sg-lede">
            Tokens and components for the v2 redesign. Every value here
            is the source of truth.
          </p>
        </section>

        <SectionTitle id="type" label="Type" />
        <TypeSection />

        <SectionTitle id="color" label="Color" />
        <ColorSection />

        <SectionTitle id="components" label="Components" />
        <ComponentsSection />
      </main>
    </div>
  );
}

function SectionTitle({ id, label }: { id: string; label: string }) {
  return (
    <h2 id={id} className="sg-h2">
      {label}
    </h2>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Type — flat list, sorted biggest → smallest by mobile size.
   No frames around samples, no nested cards. Just the sample text
   at full visual weight followed by the spec line and usage line.
   ───────────────────────────────────────────────────────────────── */

type TypeToken = {
  cls: string;
  sample: string;
  mobile: string;
  desktop?: string;
  mobilePx: number;       // for sorting
  usedIn: string;
};

const TYPE_TOKENS: TypeToken[] = [
  { cls: "ds-type-tab-header",                 sample: "Projects",                                  mobile: "39 / 400 / 0.03em",          desktop: "50 / 400 / 0.03em", mobilePx: 39, usedIn: "Page heading on Projects + Ideas tabs." },
  { cls: "ds-type-empty",                      sample: "No projects yet",                            mobile: "34 / 400 / 0 / lh 37px",     desktop: "44 / 400 / 0 / lh 37px", mobilePx: 34, usedIn: "Large empty-state copy." },
  { cls: "ds-type-empty-header",               sample: "Define Your Characters",                     mobile: "34 / 400 / 0 / lh 1",                                  mobilePx: 34, usedIn: "Layer empty-state header (Define Your Characters, etc.)." },
  { cls: "ds-type-project-page-title-empty",   sample: "Test Project",                               mobile: "25 / 400 / -0.03em / lh 29px",  desktop: "50 / 400 / -0.03em / lh auto", mobilePx: 25, usedIn: "Project title rendered ON the project image when a layer is in empty state." },
  { cls: "ds-type-project-page-title",         sample: "Where The Light Bends",                      mobile: "20 / 400 / 0",               desktop: "65 / 400 / 0", mobilePx: 20, usedIn: "Project detail page hero title." },
  { cls: "ds-type-project-card-title",         sample: "Cache",                                      mobile: "20 / 400 / 0",               desktop: "24 / 400 / 0", mobilePx: 20, usedIn: "Project card title in the home grid." },
  { cls: "ds-type-attribute-title",            sample: "Logline",                                    mobile: "13 / 600 / 0",                                            mobilePx: 13, usedIn: "Attribute row labels on project detail." },
  { cls: "ds-type-body",                       sample: "Body copy — the default text for descriptions, idea cards, search inputs.", mobile: "13 / 400 / 0 / lh 18px", mobilePx: 13, usedIn: "Idea-card text, search input, project-card meta, scene summaries." },
  { cls: "ds-type-body-bold",                  sample: "Bold body — scene-row title in the Story tab.", mobile: "13 / 700 / 0", mobilePx: 13, usedIn: "Bold variant of body. Used as the scene title in Story-tab rows." },
  { cls: "ds-type-int-header",                 sample: "INT. APARTMENT - NIGHT",                     mobile: "11 / 700 / 0.09em / UPPER",                              mobilePx: 11, usedIn: "Scene-location slug heading (INT./EXT. lines). Script-tab card slug + Script View sheet sub-title." },
  { cls: "ds-type-body-sm",                    sample: "Smaller body copy — used inside the layer empty-state caption beneath the title.", mobile: "10 / 400 / 0.03em / lh 14px", desktop: "11 / 400 / 0.03em / lh auto", mobilePx: 10, usedIn: "Empty-state caption (Define Your Characters body, Story / Script equivalents)." },
  { cls: "ds-type-cta",                        sample: "ADD A CHARACTER", mobile: "9 / 500 / 0.08em / UPPER", desktop: "11 / 500 / 0.08em / UPPER", mobilePx: 9, usedIn: "Empty-state CTAs (Add Character, Create With AI). Glyph-only — no pill outline, no fill." },
  { cls: "ds-type-button-label",               sample: "ALL",                                        mobile: "12 / 400 / 0.07em / UPPER",                              mobilePx: 12, usedIn: "Generic button labels." },
  { cls: "ds-type-draft-dropdown",             sample: "Concept Draft 1",                            mobile: "10 / 500 / 0.03em / case-as-typed",                       desktop: "11 / 500 / 0.09em / UPPER", mobilePx: 10, usedIn: "Layer draft dropdown text + project topbar draft trigger." },
  { cls: "ds-type-selected-option-label",      sample: "SITUATION",                                  mobile: "9 / 500 / 0.03em / UPPER",                                mobilePx: 9,  usedIn: "Filter pill labels in the Ideas tab." },
  { cls: "ds-type-project-card-pill-label",    sample: "THRILLER",                                   mobile: "8 / 700 / 0.03em / UPPER",   desktop: "10 / 700 / 0.03em / UPPER", mobilePx: 8, usedIn: "Genre pills on project cards." },
  { cls: "ds-type-main-tab-nav-active",        sample: "PROJECTS",                                   mobile: "8 / 900 / 0.07em / UPPER",   desktop: "14 / 700 / 0", mobilePx: 8, usedIn: "Active tab in bottom tab bar." },
  { cls: "ds-type-main-tab-nav-inactive",      sample: "IDEAS",                                      mobile: "8 / 500 / 0.07em / UPPER",   desktop: "14 / 400 / 0", mobilePx: 8, usedIn: "Inactive tab in bottom tab bar." },
  { cls: "ds-type-project-tab-nav-active",     sample: "CONCEPT",                                    mobile: "7 / 700 / 0.07em / UPPER",   desktop: "12 / 700 / 0.09em / UPPER", mobilePx: 7, usedIn: "Active section tab in project detail." },
  { cls: "ds-type-project-tab-nav-inactive",   sample: "STORY",                                      mobile: "7 / 500 / 0.07em / UPPER",   desktop: "12 / 500 / 0.09em / UPPER", mobilePx: 7, usedIn: "Inactive section tab in project detail." },
];

function TypeSection() {
  const sorted = [...TYPE_TOKENS].sort((a, b) => b.mobilePx - a.mobilePx);
  return (
    <div className="sg-list">
      {sorted.map(t => (
        <div key={t.cls} className="sg-row sg-row-type">
          <div className={`sg-type-sample ${t.cls}`}>{t.sample}</div>
          <div className="sg-meta">
            <div className="sg-meta-head">
              <code className="sg-token">.{t.cls}</code>
              <CopyIdButton id={t.cls} />
            </div>
            <span className="sg-spec">{t.mobile}{t.desktop ? <>  ·  desktop {t.desktop}</> : null}</span>
            <span className="sg-where">{t.usedIn}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Color — flat list. Big swatch on the left, name + hex + usage on
   the right. No card border. Order: brand first, then surfaces, then
   accents (which form natural largest-area-of-impact → smallest).
   ───────────────────────────────────────────────────────────────── */

type ColorToken = {
  name: string;
  hex: string;
  usedIn?: string;
};

// Ordered by visual prominence — the colors used as page-level
// surfaces/text first, accents last.
const COLORS: ColorToken[] = [
  { name: "color-black",             hex: "#000000", usedIn: "Primary ink. Buttons, headings, body text." },
  { name: "color-white",             hex: "#FFFFFF", usedIn: "Card surfaces. Ink on dark backgrounds." },
  { name: "color-app-background",    hex: "#F8F7F7", usedIn: "Page background on mobile." },
  { name: "color-gray-lightest",     hex: "#FCFBFB", usedIn: "Search bar fill, filter pill fill." },
  { name: "color-gray-fill",         hex: "#FBF9F9", usedIn: "Subtle section fills." },
  { name: "color-gray-chip-fill",    hex: "#F4F4F4", usedIn: "Tag chip fill." },
  { name: "color-gray-chip-outline", hex: "#EDEDED", usedIn: "Inactive filter pill border." },
  { name: "color-gray-outline",      hex: "#E4E3E4", usedIn: "Strong borders, dividers, search-bar outline." },
  { name: "color-gray-chip-label",   hex: "#888888", usedIn: "Subtle gray text — chip labels, timestamps." },
  { name: "color-gray-dark-fill",    hex: "#626262", usedIn: "Project-card placeholder fill." },
  { name: "color-unfold-gold",       hex: "#AC9175", usedIn: "Brand accent — premium / paid affordances." },
  { name: "color-ai-yellow",         hex: "#FFD60A", usedIn: "AI / generative actions (wand, sparkle)." },
  { name: "color-record-red",        hex: "#CE2D1E", usedIn: "Record button fill." },
  { name: "color-accent-green-on-light",  hex: "#D8EEE8", usedIn: "Genre pill: Thriller." },
  { name: "color-accent-green-on-dark",   hex: "#8CC1AE" },
  { name: "color-accent-blue-on-light",   hex: "#C7E1F4", usedIn: "Genre pill: Drama, Mystery." },
  { name: "color-accent-blue-on-dark",    hex: "#9EC2DA" },
  { name: "color-accent-purple-on-light", hex: "#D9D8EE", usedIn: "Genre pill: Sci-Fi, Horror." },
  { name: "color-accent-purple-on-dark",  hex: "#9EA0DA" },
  { name: "color-accent-red-on-light",    hex: "#F6D5D1", usedIn: "Genre pill: Romance." },
  { name: "color-accent-red-on-dark",     hex: "#F2B5B5" },
  { name: "color-accent-orange-on-light", hex: "#F6E8D1", usedIn: "Genre pill: Action." },
  { name: "color-accent-orange-on-dark",  hex: "#D8AF6D" },
  { name: "color-accent-yellow-on-light", hex: "#F5F0CB", usedIn: "Genre pill: Comedy." },
  { name: "color-accent-yellow-on-dark",  hex: "#E8E69C" },
];

function ColorSection() {
  return (
    <div className="sg-list">
      {COLORS.map(c => (
        <div key={c.name} className="sg-row sg-row-color">
          <div
            className="sg-swatch"
            style={{
              background: c.hex,
              boxShadow: c.hex.toUpperCase() === "#FFFFFF"
                ? "inset 0 0 0 1px var(--ds-color-gray-outline)"
                : undefined,
            }}
          />
          <div className="sg-meta">
            <div className="sg-meta-head">
              <code className="sg-token">--ds-{c.name}</code>
              <CopyIdButton id={`--ds-${c.name}`} />
            </div>
            <span className="sg-spec sg-hex">{c.hex.toUpperCase()}</span>
            {c.usedIn && <span className="sg-where">{c.usedIn}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Components — biggest visual surfaces first. No card frames.
   Each entry: small label, then the live component, then usage.
   ───────────────────────────────────────────────────────────────── */

function ComponentsSection() {
  return (
    <div className="sg-list">
      <ComponentRow
        title="Project card — hero"
        usedIn="Full-width row in the project list. Position determined by total card count via projectGridPattern()."
      >
        <div className="sg-frame-cards" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div className="project-card is-hero">
            <div className="project-cover" style={{ background: "var(--ds-color-gray-dark-fill)" }} />
            <div className="project-body">
              <div className="project-title ds-type-project-card-title">Falling Stars</div>
              <div className="project-meta">Draft 8 • Updated 6d Ago</div>
              <div className="project-genre">
                <span className="attr-pill ds-type-project-card-pill-label" data-genre="romance">ROMANCE</span>
              </div>
            </div>
          </div>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Project card — small"
        usedIn="2-grid rows in the project list. Wide image fits height, sides crop on mobile."
      >
        <div className="sg-frame-cards" style={{ display: "grid", gridTemplateColumns: "minmax(0, 256px)" }}>
          <div className="project-card">
            <div className="project-cover" style={{ background: "var(--ds-color-gray-dark-fill)" }} />
            <div className="project-body">
              <div className="project-title ds-type-project-card-title">Cache</div>
              <div className="project-meta">Draft 5 • Updated 2d Ago</div>
              <div className="project-genre">
                <span className="attr-pill ds-type-project-card-pill-label" data-genre="thriller">THRILLER</span>
              </div>
            </div>
          </div>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Idea card"
        usedIn="Ideas tab — type label and timestamp share the top row, body text below."
      >
        <div className="card moment-item" style={{ cursor: "default", maxWidth: 440 }}>
          <div className="moment-type ds-type-body">scene</div>
          <div className="moment-text ds-type-body">
            A man with no memory of who he is stumbles into a hostage standoff and is mistaken for someone crucial to the crime.
          </div>
          <div className="moment-time ds-type-body">2d ago</div>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Search bar"
        usedIn="Ideas tab. Single-line search with leading magnifier icon."
      >
        <div className="search-bar" style={{ maxWidth: 440 }}>
          <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input className="ds-type-body" placeholder="Search" defaultValue="" />
        </div>
      </ComponentRow>

      <ComponentRow
        title="Buttons"
        usedIn="Primary actions across the app — splash sign-in, modal CTAs, sticky bars."
      >
        <div className="sg-comp-row">
          <button className="ds-btn ds-btn-primary ds-btn-lg" type="button">
            <span className="ds-btn-label">PRIMARY</span>
          </button>
          <button className="ds-btn ds-btn-secondary ds-btn-lg" type="button">
            <span className="ds-btn-label">SECONDARY</span>
          </button>
          <button className="ds-btn ds-btn-secondary ds-btn-sm" type="button">
            <span className="ds-btn-label">SMALL</span>
          </button>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Filter chips"
        usedIn="Ideas tab — single-select filter row. Active fill is black; inactive is white with a gray outline."
      >
        <div className="sg-comp-row sg-comp-row-wrap">
          <span className="filter-pill ds-type-selected-option-label active">All</span>
          <span className="filter-pill ds-type-selected-option-label">Situation</span>
          <span className="filter-pill ds-type-selected-option-label">Conversation</span>
          <span className="filter-pill ds-type-selected-option-label">Memory</span>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Genre pills"
        usedIn="Project cards. Color-keyed by genre — see Color tokens for the mapping."
      >
        <div className="sg-comp-row sg-comp-row-wrap">
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="thriller">THRILLER</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="drama">DRAMA</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="comedy">COMEDY</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="horror">HORROR</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="sci-fi">SCI-FI</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="romance">ROMANCE</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="action">ACTION</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="mystery">MYSTERY</span>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Menu morph"
        usedIn="Top-bar menu button. Three asymmetric bars (8/17/12) animate into an X over 360ms."
      >
        <div className="sg-comp-row" style={{ gap: 32 }}>
          <span className="sg-menu-host">
            <span className="menu-toggle"><span /><span /><span /></span>
          </span>
          <span className="sg-menu-host">
            <span className="menu-toggle open"><span /><span /><span /></span>
          </span>
        </div>
      </ComponentRow>

      <ComponentRow
        title="AI wand chip"
        usedIn="Per-field AI generate trigger. 27x27 with the paired-bolt glyph (/icon-ai-button.svg), .7px inset stroke, soft drop shadow. Used inline next to attribute labels."
      >
        <button type="button" className="ai-wand" aria-label="Generate with AI">
          <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
        </button>
      </ComponentRow>

      <ComponentRow
        title="AI bulk chip — labeled"
        usedIn="Bulk-generate affordances on layer-bar right slots (Add All Characters, Add All Scenes, Script All Scenes). Same chip styling as the wand, plus a label."
      >
        <div className="sg-comp-row sg-comp-row-wrap">
          <button type="button" className="add-all-characters-chip">
            <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
            <span>Add All Characters</span>
          </button>
          <button type="button" className="add-all-scenes-chip">
            <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
            <span>Add All Scenes</span>
          </button>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Number badge"
        usedIn="21x21 outlined circle that ties a row to its position in a list. Used on Story tab beat rows (with dotted timeline connecting consecutive badges). Written-state inverts (black fill, white digit)."
      >
        <div className="sg-comp-row" style={{ gap: 14 }}>
          <span className="v2-beat-number-badge">1</span>
          <span className="v2-beat-number-badge written">2</span>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Story scene row"
        usedIn="Story-tab beat row. Number badge + dotted timeline column, then a card with a 101x72 painted thumb on the left and ds-type-body-bold title + ds-type-body summary stacked on the right."
      >
        <div className="v2-beat-row" style={{ maxWidth: 480 }}>
          <div className="v2-beat-number-col" aria-hidden="true">
            <span className="v2-beat-number-badge">1</span>
          </div>
          <div className="card v2-beat-card beat-card">
            <div className="beat-header">
              <div className="beat-grip" aria-hidden="true">
                <img src="/icon-row-move.svg" alt="" width={6} height={14} aria-hidden="true" />
              </div>
              <div
                className="v2-beat-thumb v2-beat-thumb-placeholder"
                style={{ background: "var(--ds-color-gray-dark-fill)" }}
              />
              <div className="beat-info">
                <div className="beat-name ds-type-body-bold">Opening Image</div>
                <div className="beat-summary-preview ds-type-body">A pale sun rises over a strange alien wetland.</div>
              </div>
            </div>
          </div>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Character card"
        usedIn="Characters-tab populated row. 100x120 portrait flush to the card's left edge, role pill in an accent color, ds-type-body description clamped to 2 lines, options glyph pinned top-right."
      >
        <div className="card character-card v2-character-card" style={{ maxWidth: 480 }}>
          <div className="character-header">
            <div className="v2-character-portrait v2-character-portrait-placeholder">A</div>
            <div className="v2-character-body">
              <div className="v2-character-name ds-type-project-card-title">Alessandra Vance</div>
              <div className="v2-character-role-pill v2-character-role-protagonist">PROTAGONIST</div>
              <div className="v2-character-description ds-type-body">
                A reserved forensic accountant whose carefully ordered life starts unraveling.
              </div>
            </div>
            <span className="v2-character-menu" aria-hidden="true">
              <img src="/icon-options.svg" alt="" />
            </span>
          </div>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Script row"
        usedIn="Script-tab populated row. 32x32 number badge inside the card top-left, then ds-type-int-header slug, ds-type-project-card-title scene name, ds-type-body summary, page-range + per-scene chip footer."
      >
        <div className="v2-script-row" style={{ maxWidth: 480 }}>
          <div className="card v2-script-card beat-card">
            <span className="v2-script-number-badge" aria-hidden="true">1</span>
            <button type="button" className="v2-script-options" aria-label="Scene options">
              <img src="/icon-options.svg" alt="" aria-hidden="true" />
            </button>
            <span className="v2-script-card-tap">
              <div className="v2-script-slug ds-type-int-header">INT. APARTMENT - NIGHT</div>
              <div className="v2-script-name ds-type-project-card-title">Opening: The Glitch</div>
              <p className="v2-script-summary ds-type-body">
                Waves crash against the rocks as a lone figure watches from the cliffs.
              </p>
            </span>
            <div className="v2-script-footer">
              <span className="v2-script-pages ds-type-body">p. 1 - 3</span>
              <button type="button" className="add-all-scenes-chip v2-script-scene-chip">
                <img src="/icon-script-sml.svg" alt="" aria-hidden="true" width={10.86} height={11.27} />
                <span>View Script</span>
              </button>
            </div>
          </div>
        </div>
      </ComponentRow>

<ComponentRow
        title="Inline attribute input"
        usedIn="Single-line text fields that sit inline with the row label rather than expanding below it. Used by Concept Title, Character Name, Character Age, and Scene Name."
      >
        <div className="attr-row attr-row-inline-input" style={{ maxWidth: 480 }}>
          <div className="attr-row-header">
            <span className="attr-label">Title</span>
            <div className="attr-values">
              <input
                className="attr-inline-text-input"
                placeholder="Add a title"
                defaultValue="Cache"
              />
            </div>
          </div>
        </div>
      </ComponentRow>

      <ComponentRow
        title="Options glyph"
        usedIn="Three-dot more-actions icon. 13x3 PNG/SVG. Pinned absolutely at top-right of card surfaces."
      >
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 }}>
          <img src="/icon-options.svg" alt="" width={13} height={3} aria-hidden="true" />
        </span>
      </ComponentRow>

      <ComponentRow
        title="Image shimmer"
        usedIn="`.ds-image-shimmer` — drop onto a placeholder div sized like the eventual image. Renders ONLY while an AI image-generation API call is in-flight for that asset (project thumbnail, scene thumb, character portrait). Pair with `.is-dark` over dark surfaces (e.g. project covers). Honors prefers-reduced-motion."
      >
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div className="ds-image-shimmer" style={{ width: 100, height: 122, borderRadius: 12 }} />
          <div className="ds-image-shimmer" style={{ width: 101, height: 72, borderRadius: 8 }} />
          <div className="ds-image-shimmer is-dark" style={{ width: 80, height: 107, borderRadius: 6 }} />
        </div>
      </ComponentRow>
    </div>
  );
}

function ComponentRow({
  title, usedIn, children,
}: {
  title: string;
  usedIn: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sg-row sg-row-component">
      <div className="sg-meta">
        <div className="sg-meta-head">
          <span className="sg-comp-label">{title}</span>
          <CopyIdButton id={title} />
        </div>
        <span className="sg-where">{usedIn}</span>
      </div>
      <div className="sg-comp-demo">{children}</div>
    </div>
  );
}
