"use client";

// V2 Style Guide — single page that documents every type token, color
// token, and redesigned component in one place. Eats its own dog food:
// the page itself uses the v2 tokens/components it documents.
//
// Gated to v2 viewers via useIsV2(). Non-v2 viewers redirect home —
// the page would render correctly but the visual system isn't theirs
// to see yet.
//
// Sections:
//   - Type tokens     — every .ds-type-* utility class with a live
//                       sample and where it's applied today
//   - Color tokens    — every --ds-color-* CSS var with swatch + hex
//                       + usage notes
//   - Components      — buttons, search bar, filter chips, project
//                       card, idea card, genre pills, menu morph
//
// Layout adapts at 1440px (desktop = sidebar TOC + 2-column section
// grids; mobile = single column with flat anchor links).

import { useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useIsV2 } from "@/lib/v2Access";

export default function StyleGuidePage() {
  const { user, loading } = useAuth();
  const isV2 = useIsV2();

  // Force the v2 design tokens on while this page is open, regardless
  // of the global flag — the guide MUST render in v2 to be useful.
  // Restore on unmount so the rest of the app picks up wherever it
  // was. Layout's pre-hydration script will set the right value on
  // the next full nav.
  useEffect(() => {
    const prev = document.documentElement.dataset.design;
    document.documentElement.dataset.design = "v2";
    return () => {
      if (prev) document.documentElement.dataset.design = prev;
    };
  }, []);

  // Boot the auth context off the splash. While loading, render the
  // guide unconditionally — the visuals don't depend on user data.
  // After loading resolves, kick non-v2 users home.
  useEffect(() => {
    if (loading) return;
    if (!user || !isV2) {
      if (typeof window !== "undefined") window.location.href = "/";
    }
  }, [loading, user, isV2]);

  return (
    <div className="sg-page">
      <div className="sg-topbar">
        <Link href="/" className="sg-back" aria-label="Back to app">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          <span>Back</span>
        </Link>
      </div>

      <div className="sg-hero">
        <div className="ds-type-tab-header sg-hero-eyebrow">Design</div>
        <h1 className="sg-hero-title">Style Guide</h1>
        <p className="sg-hero-sub">
          Tokens and components for the v2 redesign. Every value here
          is the source of truth — never copy a hex code or font size
          out of this page. Reference the token instead.
        </p>
      </div>

      <nav className="sg-toc">
        <a href="#type">Type</a>
        <a href="#color">Color</a>
        <a href="#components">Components</a>
      </nav>

      <Section id="type" title="Type tokens" caption="Utility classes — apply via className. Mobile-first; values flip at 1440px desktop breakpoint.">
        <TypeTokens />
      </Section>

      <Section id="color" title="Color tokens" caption="CSS variables. Apply as background / color / border via var(--ds-color-*).">
        <ColorTokens />
      </Section>

      <Section id="components" title="Components" caption="Common patterns redesigned for v2. Each card shows a live render plus where it's used.">
        <Components />
      </Section>

      <div className="sg-footer">
        <span className="ds-type-body">v2 design system · luis@unfold.dev</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Section wrapper — section heading + caption + content area
   ───────────────────────────────────────────────────────────────── */
function Section({
  id, title, caption, children,
}: {
  id: string;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="sg-section">
      <header className="sg-section-header">
        <h2 className="sg-section-title">{title}</h2>
        <p className="sg-section-caption">{caption}</p>
      </header>
      <div className="sg-section-body">{children}</div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Type tokens — every .ds-type-* utility class as a live sample
   ───────────────────────────────────────────────────────────────── */
const TYPE_TOKENS: Array<{
  cls: string;
  sample?: string;
  mobile: string;
  desktop?: string;
  family: "display" | "body";
  usedIn: string;
}> = [
  {
    cls: "ds-type-tab-header",
    sample: "Projects",
    mobile: "39 / 400 / 0.03em",
    desktop: "50 / 400 / 0.03em",
    family: "display",
    usedIn: "Page heading on Projects + Ideas tabs.",
  },
  {
    cls: "ds-type-project-page-title",
    sample: "Where The Light Bends",
    mobile: "20 / 400 / 0",
    desktop: "65 / 400 / 0",
    family: "display",
    usedIn: "Project detail page hero title (not yet wired).",
  },
  {
    cls: "ds-type-project-card-title",
    sample: "Cache",
    mobile: "20 / 400 / 0",
    desktop: "24 / 400 / 0",
    family: "display",
    usedIn: "Project card title in the home grid.",
  },
  {
    cls: "ds-type-empty",
    sample: "No projects yet",
    mobile: "34 / 400 / 0 / lh 37px",
    desktop: "44 / 400 / 0 / lh 37px",
    family: "display",
    usedIn: "Large empty-state copy (not yet wired).",
  },
  {
    cls: "ds-type-project-card-pill-label",
    sample: "THRILLER",
    mobile: "8 / 700 / 0.03em / UPPER",
    desktop: "10 / 700 / 0.03em / UPPER",
    family: "body",
    usedIn: "Genre pills on project cards.",
  },
  {
    cls: "ds-type-main-tab-nav-active",
    sample: "PROJECTS",
    mobile: "8 / 900 / 0.07em / UPPER",
    desktop: "14 / 700 / 0",
    family: "body",
    usedIn: "Active tab in bottom tab bar.",
  },
  {
    cls: "ds-type-main-tab-nav-inactive",
    sample: "Ideas",
    mobile: "14 / 500 / 0.07em / UPPER",
    desktop: "14 / 400 / 0",
    family: "body",
    usedIn: "Inactive tab in bottom tab bar.",
  },
  {
    cls: "ds-type-project-tab-nav-active",
    sample: "CONCEPT",
    mobile: "7 / 700 / 0.07em / UPPER",
    desktop: "12 / 700 / 0.09em / UPPER",
    family: "body",
    usedIn: "Active section tab in project detail (not yet wired).",
  },
  {
    cls: "ds-type-project-tab-nav-inactive",
    sample: "STORY",
    mobile: "7 / 500 / 0.07em / UPPER",
    desktop: "12 / 500 / 0.09em / UPPER",
    family: "body",
    usedIn: "Inactive section tab in project detail (not yet wired).",
  },
  {
    cls: "ds-type-attribute-title",
    sample: "Logline",
    mobile: "13 / 600 / 0",
    family: "body",
    usedIn: "Attribute row labels on project detail (not yet wired).",
  },
  {
    cls: "ds-type-body",
    sample: "Body copy — the default text style for descriptions, idea cards, search inputs, and most paragraph-level content.",
    mobile: "13 / 400 / 0",
    family: "body",
    usedIn: "Idea card text, search input, project-card meta line.",
  },
  {
    cls: "ds-type-selected-option-label",
    sample: "PRIMARY",
    mobile: "9 / 500 / 0.03em / UPPER",
    family: "body",
    usedIn: "Selected-option chip labels (not yet wired).",
  },
  {
    cls: "ds-type-button-label",
    sample: "ALL",
    mobile: "12 / 400 / 0.07em / UPPER",
    family: "body",
    usedIn: "Filter pill labels in the Ideas tab.",
  },
];

function TypeTokens() {
  return (
    <div className="sg-grid sg-grid-type">
      {TYPE_TOKENS.map(t => (
        <div key={t.cls} className="sg-card">
          <div className={`sg-type-sample sg-type-sample-${t.family} ${t.cls}`}>
            {t.sample}
          </div>
          <div className="sg-card-meta">
            <code className="sg-token-name">.{t.cls}</code>
            <div className="sg-spec">
              <span className="sg-spec-label">Mobile</span>
              <span>{t.mobile}</span>
            </div>
            {t.desktop && (
              <div className="sg-spec">
                <span className="sg-spec-label">Desktop</span>
                <span>{t.desktop}</span>
              </div>
            )}
            <div className="sg-usage">{t.usedIn}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Color tokens — swatch + name + hex + usage
   ───────────────────────────────────────────────────────────────── */
type ColorGroup = {
  group: string;
  caption?: string;
  tokens: Array<{ name: string; hex: string; usedIn?: string; onDark?: boolean }>;
};

const COLOR_GROUPS: ColorGroup[] = [
  {
    group: "Brand",
    tokens: [
      { name: "color-black",       hex: "#000000", usedIn: "Primary ink. Buttons, headings, body text." },
      { name: "color-white",       hex: "#FFFFFF", usedIn: "Card surfaces, ink on dark backgrounds.", onDark: true },
      { name: "color-unfold-gold", hex: "#AC9175", usedIn: "Brand accent — reserved for premium / paid affordances." },
      { name: "color-ai-yellow",   hex: "#FFD60A", usedIn: "AI / generative actions (wand, sparkle, generation chips)." },
    ],
  },
  {
    group: "Surfaces & grays",
    tokens: [
      { name: "color-app-background",    hex: "#F8F7F7", usedIn: "Page background on mobile." },
      { name: "color-gray-fill",         hex: "#FBF9F9", usedIn: "Subtle section fills." },
      { name: "color-gray-outline",      hex: "#E4E3E4", usedIn: "Strong borders / dividers." },
      { name: "color-gray-chip-outline", hex: "#EDEDED", usedIn: "Inactive filter pill border." },
      { name: "color-gray-chip-fill",    hex: "#F4F4F4", usedIn: "Search bar fill, tag chip fill." },
      { name: "color-gray-chip-label",   hex: "#888888", usedIn: "Subtle gray text — chip labels, timestamps, idea-card type." },
      { name: "color-gray-dark-fill",    hex: "#626262", usedIn: "Project-card placeholder fill." },
    ],
  },
  {
    group: "Accents — green",
    caption: "Each accent ships as an on-dark / on-light pair. on-dark goes on dark surfaces; on-light is the soft tint for light backgrounds.",
    tokens: [
      { name: "color-accent-green-on-dark",  hex: "#8CC1AE" },
      { name: "color-accent-green-on-light", hex: "#D8EEE8", usedIn: "Genre pill: Thriller." },
    ],
  },
  {
    group: "Accents — red",
    tokens: [
      { name: "color-accent-red-on-dark",  hex: "#F2B5B5" },
      { name: "color-accent-red-on-light", hex: "#F6D5D1", usedIn: "Genre pill: Romance." },
    ],
  },
  {
    group: "Accents — blue",
    tokens: [
      { name: "color-accent-blue-on-dark",  hex: "#9EC2DA" },
      { name: "color-accent-blue-on-light", hex: "#C7E1F4", usedIn: "Genre pill: Drama, Mystery." },
    ],
  },
  {
    group: "Accents — yellow",
    tokens: [
      { name: "color-accent-yellow-on-dark",  hex: "#E8E69C" },
      { name: "color-accent-yellow-on-light", hex: "#F5F0CB", usedIn: "Genre pill: Comedy." },
    ],
  },
  {
    group: "Accents — purple",
    tokens: [
      { name: "color-accent-purple-on-dark",  hex: "#9EA0DA" },
      { name: "color-accent-purple-on-light", hex: "#D9D8EE", usedIn: "Genre pill: Sci-Fi, Horror." },
    ],
  },
  {
    group: "Accents — orange",
    tokens: [
      { name: "color-accent-orange-on-dark",  hex: "#D8AF6D" },
      { name: "color-accent-orange-on-light", hex: "#F6E8D1", usedIn: "Genre pill: Action." },
    ],
  },
];

function ColorTokens() {
  return (
    <div className="sg-color-groups">
      {COLOR_GROUPS.map(g => (
        <div key={g.group} className="sg-color-group">
          <div className="sg-color-group-title">{g.group}</div>
          {g.caption && <div className="sg-color-group-caption">{g.caption}</div>}
          <div className="sg-grid sg-grid-color">
            {g.tokens.map(t => (
              <div key={t.name} className="sg-card sg-card-color">
                <div
                  className="sg-swatch"
                  style={{
                    background: t.hex,
                    color: t.onDark ? "var(--ds-color-black)" : "var(--ds-color-black)",
                    boxShadow: t.hex.toUpperCase() === "#FFFFFF" ? "inset 0 0 0 1px var(--ds-color-gray-outline)" : undefined,
                  }}
                />
                <div className="sg-card-meta">
                  <code className="sg-token-name">--ds-{t.name}</code>
                  <div className="sg-hex">{t.hex.toUpperCase()}</div>
                  {t.usedIn && <div className="sg-usage">{t.usedIn}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Components — live mini-demos of redesigned UI surfaces
   ───────────────────────────────────────────────────────────────── */
function Components() {
  return (
    <div className="sg-components">
      <ComponentCard
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
      </ComponentCard>

      <ComponentCard
        title="Search bar"
        usedIn="Ideas tab. Single-line search with leading magnifier icon."
      >
        <div className="search-bar">
          <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input className="ds-type-body" placeholder="Search" defaultValue="" />
        </div>
      </ComponentCard>

      <ComponentCard
        title="Filter chips"
        usedIn="Ideas tab — single-select filter row. Active fill is black; inactive is white with a gray outline."
      >
        <div className="sg-comp-row sg-comp-row-wrap">
          <span className="filter-pill ds-type-button-label active">All</span>
          <span className="filter-pill ds-type-button-label">Situation</span>
          <span className="filter-pill ds-type-button-label">Conversation</span>
          <span className="filter-pill ds-type-button-label">Memory</span>
        </div>
      </ComponentCard>

      <ComponentCard
        title="Genre pills"
        usedIn="Project cards. Color-keyed by genre — see Color tokens for the mapping."
      >
        <div className="sg-comp-row sg-comp-row-wrap sg-comp-row-genre">
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="thriller">THRILLER</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="drama">DRAMA</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="comedy">COMEDY</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="horror">HORROR</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="sci-fi">SCI-FI</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="romance">ROMANCE</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="action">ACTION</span>
          <span className="attr-pill ds-type-project-card-pill-label" data-genre="mystery">MYSTERY</span>
        </div>
      </ComponentCard>

      <ComponentCard
        title="Project card — small"
        usedIn="2-grid rows in the project list. Wide image fits height, sides crop on mobile."
      >
        <div className="sg-comp-card-frame">
          <div className="project-card sg-comp-project-card">
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
      </ComponentCard>

      <ComponentCard
        title="Project card — hero"
        usedIn="Full-width row in the project list. Position determined by total card count via projectGridPattern()."
      >
        <div className="sg-comp-card-frame">
          <div className="project-card is-hero sg-comp-project-card">
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
      </ComponentCard>

      <ComponentCard
        title="Idea card"
        usedIn="Ideas tab — type label and timestamp share the top row, body text below."
      >
        <div className="card moment-item" style={{ cursor: "default" }}>
          <div className="moment-type ds-type-body">scene</div>
          <div className="moment-text ds-type-body">
            A man with no memory of who he is stumbles into a hostage standoff and is mistaken for someone crucial to the crime.
          </div>
          <div className="moment-time ds-type-body">2d ago</div>
        </div>
      </ComponentCard>

      <ComponentCard
        title="Menu morph"
        usedIn="Top-bar menu button. Three asymmetric bars (8/17/12) animate into an X over 360ms."
      >
        <div className="sg-comp-row">
          <div className="sg-menu-demo">
            <span className="sg-menu-label">Closed</span>
            <span className="sg-menu-toggle-host">
              <span className="menu-toggle">
                <span /><span /><span />
              </span>
            </span>
          </div>
          <div className="sg-menu-demo">
            <span className="sg-menu-label">Open</span>
            <span className="sg-menu-toggle-host">
              <span className="menu-toggle open">
                <span /><span /><span />
              </span>
            </span>
          </div>
        </div>
      </ComponentCard>
    </div>
  );
}

function ComponentCard({
  title, usedIn, children,
}: {
  title: string;
  usedIn: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sg-card sg-card-component">
      <div className="sg-card-component-title">{title}</div>
      <div className="sg-card-component-demo">{children}</div>
      <div className="sg-usage">{usedIn}</div>
    </div>
  );
}
