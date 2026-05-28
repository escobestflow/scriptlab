"use client";

// Desktop-only left rail. Persistent across every desktop surface
// (Projects, Ideas, Studio, Settings, /admin/usage, etc.) so the user
// always has a clear path back to the main app sections. On mobile,
// the sidebar is hidden via CSS (`.desktop-sidebar` is desktop-only
// in globals.css) — mobile uses the bottom tabbar instead.
//
// Extracted from app/page.tsx so admin / standalone pages can reuse
// the same nav chrome. Each consumer wires their own callbacks for
// onProjects / onIdeas / onMenu — the sidebar itself is presentational.

import React from "react";

// Public type — exposes the set of "main tabs" the sidebar can mark
// active. Imported by callers so they don't redeclare it.
export type MainTab = "projects" | "moments" | "settings";

const IconUser = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 00-16 0"/></svg>
);

export function DesktopSidebar({
  activeMain,
  inStudio,
  onProjects,
  onIdeas,
  onMenu,
  userInitial,
  userAvatarUrl,
  userDisplayName,
}: {
  /** Which main tab is currently selected. `null` when the user is
   *  on a surface outside the main tab set (e.g. /admin/usage) — no
   *  pill is highlighted in that case. */
  activeMain: MainTab | null;
  /** True when the user is inside a project's Studio. Keeps the
   *  Projects pill highlighted while in Studio since it's a child
   *  view conceptually. */
  inStudio: boolean;
  onProjects: () => void;
  onIdeas: () => void;
  onMenu: () => void;
  userInitial: string | null;
  /** Google profile image URL (`user_metadata.avatar_url` / `picture`).
   *  When present we render it inside the avatar circle; otherwise we
   *  fall back to the first-letter initial, then a generic user glyph. */
  userAvatarUrl: string | null;
  /** Google display name (`user_metadata.full_name` / `name`) or the
   *  email's local part as a fallback. Labels the account row at the
   *  bottom of the sidebar. */
  userDisplayName: string | null;
}) {
  // Projects stays "active" in the sidebar when the user is inside
  // a project detail (Studio view) — Studio is conceptually a
  // child of the Projects section, so the nav-rail visual reflects
  // that. Ideas is only active when the user is on the Ideas tab.
  const projectsActive = inStudio || activeMain === "projects";
  const ideasActive = !inStudio && activeMain === "moments";
  return (
    <aside className="desktop-sidebar" aria-label="Primary">
      <div className="desktop-sidebar-brand">
        <img src="/logo.svg" alt="Unfold" className="desktop-sidebar-logo" />
      </div>
      <nav className="desktop-sidebar-nav">
        <button
          className={`desktop-sidebar-item ${projectsActive ? "active" : ""}`}
          onClick={onProjects}
        >
          <span className="desktop-sidebar-icon">
            <img
              src={projectsActive ? "/project-icon-active.svg" : "/project-icon-inactive.svg"}
              alt=""
            />
          </span>
          {/* Typography from the design system: active vs inactive
              nav tokens differ in weight (700 / 400 on desktop) and
              the inspector reports them correctly so this stays in
              sync with the rest of the system. */}
          <span
            className={`desktop-sidebar-label ${projectsActive ? "ds-type-main-tab-nav-active" : "ds-type-main-tab-nav-inactive"}`}
          >
            Projects
          </span>
        </button>
        <button
          className={`desktop-sidebar-item ${ideasActive ? "active" : ""}`}
          onClick={onIdeas}
        >
          <span className="desktop-sidebar-icon">
            <img
              src={ideasActive ? "/ideas-icon-active.svg" : "/ideas-icon-inactive.svg"}
              alt=""
            />
          </span>
          <span
            className={`desktop-sidebar-label ${ideasActive ? "ds-type-main-tab-nav-active" : "ds-type-main-tab-nav-inactive"}`}
          >
            Ideas
          </span>
        </button>
      </nav>
      <div className="desktop-sidebar-foot">
        <button
          className="desktop-sidebar-item desktop-sidebar-account"
          onClick={onMenu}
          aria-label="Open settings"
        >
          {/* Avatar circle: prefer the Google profile image when
              available, fall back to the email's first letter,
              then to a generic user glyph. */}
          <span className="desktop-sidebar-avatar">
            {userAvatarUrl
              ? (
                <img
                  src={userAvatarUrl}
                  alt=""
                  className="desktop-sidebar-avatar-img"
                  referrerPolicy="no-referrer"
                />
              )
              : userInitial
                ? userInitial
                : <IconUser />}
          </span>
          <span className="desktop-sidebar-account-name">
            {userDisplayName ?? "Account"}
          </span>
          <svg
            className="desktop-sidebar-account-chevron"
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 1l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <img
            src="/icon-account.svg"
            alt=""
            aria-hidden="true"
            width={20}
            height={20}
            className="desktop-sidebar-account-gear"
          />
        </button>
      </div>
    </aside>
  );
}

/** Reads the Supabase auth user's metadata to extract the four
 *  display fields the sidebar needs (initial, avatar URL, display
 *  name, email). Shared between every consumer of `DesktopSidebar`
 *  so the same precedence rules (Google avatar → initial → glyph;
 *  Google full name → email local part → "Account") apply
 *  everywhere. */
export function deriveSidebarUserFields(user: { email?: string | null; user_metadata?: unknown } | null | undefined) {
  const userEmailTrimmed = (user?.email ?? "").trim();
  const userInitial = userEmailTrimmed ? userEmailTrimmed.charAt(0).toUpperCase() : null;
  const userMetadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const rawAvatar =
    userMetadata.avatar_url
    ?? userMetadata.picture
    ?? null;
  const userAvatarUrl = typeof rawAvatar === "string" && rawAvatar.length > 0
    ? rawAvatar
    : null;
  const rawDisplayName =
    userMetadata.full_name
    ?? userMetadata.name
    ?? null;
  const userDisplayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim().length > 0
      ? rawDisplayName.trim()
      : (userEmailTrimmed.split("@")[0] || null);
  return {
    userEmail: userEmailTrimmed,
    userInitial,
    userAvatarUrl,
    userDisplayName,
  };
}
