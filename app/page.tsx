"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Story, getActiveConceptDraft, getActiveStoryLayerDraft, updateConceptDraft } from "@/lib/story";
import { Moment } from "@/lib/sampleData";
import {
  loadProjectsFromDB, saveProjectToDB, deleteProjectFromDB, newBlankProject,
  loadMomentsFromDB, saveMomentToDB, deleteMomentFromDB,
} from "@/lib/storage";
import { useAuth } from "@/lib/auth";
import { Studio } from "@/components/Studio";
import SplashLoader from "@/components/SplashLoader";
import { useWriterProfile, WriterProfileContext, useProfileCapture } from "@/lib/writerProfileStore";
import type { WriterProfile } from "@/lib/writerProfile";
import { Genre, ProjectType } from "@/lib/story";
import { useAutosavePref } from "@/lib/prefs";
import { Button, Input, Textarea, Selector } from "@/components/ui";

type View =
  | { kind: "main" }
  | { kind: "studio"; projectId: string; isNew?: boolean };

type MainTab = "projects" | "moments";

/* ======= SVG Icons (from design assets) ======= */
const IconSearch = () => (
  <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
);
const IconSettings = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 00-16 0"/></svg>
);
const IconExport = () => (
  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
);
const IconZap = () => (
  <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);

export default function Page() {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
  // Writer profile — cumulative creative-preference + voice model used to
  // bias every AI generation. Persisted per user in Supabase, mirrored to
  // localStorage for instant first-paint. See lib/writerProfile.ts.
  const profileAPI = useWriterProfile(user?.id ?? null);
  const [projects, setProjects] = useState<Story[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [view, setView] = useState<View>({ kind: "main" });
  const [mainTab, setMainTab] = useState<MainTab>("projects");
  const [menuOpen, setMenuOpen] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useAutosavePref();
  const [recording, setRecording] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [recordSheetOpen, setRecordSheetOpen] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [editingMoment, setEditingMoment] = useState<Moment | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  // Email-send feedback — independent of the "Idea Added" toast so
  // sending doesn't clobber a recent moment-capture confirmation, and
  // vice versa. `null` = hidden; any non-empty string shows the
  // message. Cleared after 3.5s so "Sent!" lingers long enough to
  // read but doesn't persist.
  const [emailToast, setEmailToast] = useState<string | null>(null);
  // `true` while /api/send-email is in flight. Gates the Studio
  // top-nav envelope icon and the hamburger menu item so the user
  // can't double-fire a send.
  const [emailBusy, setEmailBusy] = useState(false);
  // Which project the email sheet is currently configured for; null
  // when the sheet is closed. Holding the whole Story (not just an
  // id) means the sheet captures the snapshot the user saw when they
  // opened it — subsequent edits don't mid-flight the send.
  const [emailSheetStory, setEmailSheetStory] = useState<Story | null>(null);
  // Per-attachment toggles. Defaults: all three real artifacts on.
  // The "coming soon" rows have no state — they're pure UI signals.
  const [emailInclude, setEmailInclude] = useState({
    pdf: true,
    fountain: true,
    json: true,
  });
  // Splash flag — true once the animated splash has fully dismissed.
  // Persisted to sessionStorage so revisiting the root route mid-session
  // doesn't replay the 6.59s intro. Cleared when the tab closes.
  const [splashDone, setSplashDone] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.sessionStorage.getItem("unfoldSplashSeen") === "1"; }
    catch { return false; }
  });
  // New project creation modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [createDraft, setCreateDraft] = useState<Story | null>(null);
  // Track whether the user has actively chosen a format. newBlankProject()
  // defaults projectType to "feature" so state is valid from the start,
  // but visually we treat Format as "unselected" until the user taps a
  // choice — which is what gates the Step 0 Continue button.
  const [createFormatTouched, setCreateFormatTouched] = useState(false);
  // New idea (moment) sheet — mirrors the Project/Idea creation UX.
  const [newIdeaOpen, setNewIdeaOpen] = useState(false);
  const [newIdeaText, setNewIdeaText] = useState("");
  const [newIdeaType, setNewIdeaType] = useState<Moment["type"]>("scene");
  // Clean-up spinner state for the New Idea sheet (Clean-up was hoisted
  // out of IdeaFields so it can sit next to Save in the action row).
  const [newIdeaCleaning, setNewIdeaCleaning] = useState(false);
  // Record sheet shares the unified idea composer — keep its type + tags
  // here so the two sheets behave identically except for the record FAB.
  const [recordType, setRecordType] = useState<Moment["type"]>("scene");
  const [recordTags, setRecordTags] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);
  const capturedRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Note on splash gating: we don't reset splashDone on sign-out any more —
  // the render gate below shows the splash whenever there's no confirmed
  // session (user=null AND authLoading=false), so mid-session sign-outs
  // naturally land on the animated sign-in screen without any state reset.

  // Load data from Supabase when user is authenticated. First-time users
  // land on the Projects tab's empty state — no auto-seeded sample —
  // and create their first project themselves from there.
  useEffect(() => {
    if (!user) { setHydrated(false); return; }
    (async () => {
      const [p, m] = await Promise.all([
        loadProjectsFromDB(user.id),
        loadMomentsFromDB(user.id),
      ]);
      setProjects(p);
      setMoments(m);
      setHydrated(true);
    })();
  }, [user]);

  // Debounced save: when projects change, save to DB after 1s of inactivity
  const saveProjectsDebounced = useCallback((ps: Story[]) => {
    if (!user) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      ps.forEach(p => saveProjectToDB(user.id, p));
    }, 1000);
  }, [user]);

  useEffect(() => {
    if (hydrated && user) saveProjectsDebounced(projects);
  }, [projects, hydrated, user, saveProjectsDebounced]);

  // Auto-generate thumbnails for projects that don't have one
  const thumbnailGenRef = useRef(false);
  useEffect(() => {
    if (!hydrated || thumbnailGenRef.current) return;
    const missing = projects.filter(p => !p.thumbnail && p.title);
    if (missing.length === 0) return;
    thumbnailGenRef.current = true;
    (async () => {
      for (const p of missing) {
        try {
          const res = await fetch("/api/generate-thumbnail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: p.title, logline: getActiveConceptDraft(p).logline, genres: getActiveConceptDraft(p).settings.genres }),
          });
          if (!res.ok) continue;
          const data = await res.json();
          if (data.thumbnail) {
            setProjects(ps => ps.map(pr =>
              pr.id === p.id ? { ...pr, thumbnail: data.thumbnail } : pr
            ));
          }
        } catch {}
      }
    })();
  }, [hydrated, projects]);

  const updateProject = (id: string, u: (s: Story) => Story) =>
    setProjects(ps => ps.map(p => p.id === id ? { ...u(p), updatedAt: new Date().toISOString() } : p));

  // ── Voice capture ──
  function startRecording() {
    setRecordSheetOpen(true);
    setLiveTranscript("");
    capturedRef.current = "";

    const SR: any =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SR) {
      // No speech API — just show the sheet for manual typing
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) capturedRef.current += e.results[i][0].transcript + " ";
        else interim += e.results[i][0].transcript;
      }
      setLiveTranscript((capturedRef.current + interim).trim());
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  }

  function stopRecording() {
    recognitionRef.current?.stop();
    setRecording(false);
  }

  function saveDraftMoment(text: string, type: Moment["type"], tags: string[] = []) {
    // Always stop the mic first — saving from the Record sheet should
    // release speech recognition, not leave it listening in the
    // background after the sheet closes.
    stopRecording();
    const m: Moment = {
      id: "m_" + Math.random().toString(36).slice(2),
      text,
      type,
      tags,
      createdAt: new Date().toISOString(),
    };
    setMoments(prev => [m, ...prev]);
    if (user) saveMomentToDB(user.id, m);
    // Profile signal: every saved moment is a prose sample in the user's
    // own voice. Feeds the style-metric running averages + exemplar pool.
    profileAPI.captureStyle(text, "moment");
    setRecordSheetOpen(false);
    setLiveTranscript("");
    setRecordType("scene");
    setRecordTags([]);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  async function generateThumbnail(projectId: string, title: string, logline: string, genres: string[]) {
    try {
      const res = await fetch("/api/generate-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, logline, genres }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.thumbnail) {
        setProjects(ps => ps.map(p =>
          p.id === projectId ? { ...p, thumbnail: data.thumbnail } : p
        ));
      }
    } catch {}
  }

  function updateMoment(id: string, patch: Partial<Moment>) {
    const updated = moments.find(m => m.id === id);
    if (updated && user) saveMomentToDB(user.id, { ...updated, ...patch });
    setMoments(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  }

  function deleteMoment(id: string) {
    deleteMomentFromDB(id);
    setMoments(prev => prev.filter(m => m.id !== id));
    setEditingMoment(null);
  }

  // ── Splash / sign-in gate ──
  // The animated Unfold splash is the sign-in surface AND the boot
  // loading screen. Rules:
  //   1. If the splash hasn't been dismissed on this tab yet → play it.
  //      Fresh first-load and return-from-OAuth-redirect both land
  //      here; for signed-in users the SplashLoader auto-dismisses.
  //   2. If auth has resolved to a null user → show the splash again
  //      as the sign-back-in surface (covers mid-session sign-out and
  //      token expiry). Guarded by !authLoading so a transient null
  //      during OAuth restore doesn't replay the animation.
  const showSplash = !splashDone || (!authLoading && !user);
  if (showSplash) {
    return (
      <SplashLoader
        authLoading={authLoading}
        signedIn={!!user}
        signInWithGoogle={signInWithGoogle}
        onDismiss={() => {
          if (typeof window !== "undefined") {
            try { window.sessionStorage.setItem("unfoldSplashSeen", "1"); } catch {}
          }
          setSplashDone(true);
        }}
      />
    );
  }

  // Splash is done AND auth is loading — tiny bridge state while
  // Supabase restores the session after OAuth redirect-back.
  if (authLoading) {
    return (
      <div className="app" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="caption">Loading…</div>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="app" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="caption">Loading your projects…</div>
      </div>
    );
  }

  const studioProject = view.kind === "studio"
    ? projects.find(p => p.id === (view as any).projectId) ?? null
    : null;

  // If studio project not found, fall back
  if (view.kind === "studio" && !studioProject) {
    setView({ kind: "main" });
    return <div className="app" />;
  }

  // ── New project creation helpers ──
  function openCreateModal() {
    setCreateDraft(newBlankProject());
    setCreateStep(0);
    setCreateFormatTouched(false);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setCreateDraft(null);
    setCreateStep(0);
    setCreateFormatTouched(false);
  }

  function finishCreate() {
    if (!createDraft) return;
    const saved = createDraft;
    setProjects(ps => [saved, ...ps]);
    if (user) saveProjectToDB(user.id, saved);
    closeCreateModal();
    setView({ kind: "studio", projectId: saved.id, isNew: true });
    generateThumbnail(saved.id, saved.title, getActiveConceptDraft(saved).logline, getActiveConceptDraft(saved).settings.genres);
  }

  function updateDraft(u: (s: Story) => Story) {
    setCreateDraft(prev => prev ? u(prev) : prev);
  }

  // ── Email the project bundle ──
  // The triggers (Studio top-nav envelope + hamburger item) open a
  // picker sheet so the user can choose which artifacts to attach.
  // The actual send only fires from the sheet's "Send" button.

  function openEmailSheet(story: Story) {
    // Reset includes to defaults each open — the sheet is meant to
    // feel like a quick checklist, not a persistent preference.
    setEmailInclude({ pdf: true, fountain: true, json: true });
    setEmailSheetStory(story);
  }
  function closeEmailSheet() {
    if (emailBusy) return;   // lock closure during in-flight send
    setEmailSheetStory(null);
  }

  async function sendProjectBundleEmail(
    story: Story,
    include: { pdf: boolean; fountain: boolean; json: boolean },
  ) {
    if (!user?.email) {
      setEmailToast("You need to be signed in to email projects.");
      setTimeout(() => setEmailToast(null), 3500);
      return;
    }
    if (emailBusy) return;
    setEmailBusy(true);
    setEmailToast("Sending…");
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "project_bundle",
          story,
          toEmail: user.email,
          include,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setEmailToast(`Sent to ${user.email}`);
      setEmailSheetStory(null);
    } catch (err: any) {
      setEmailToast(`Failed to send: ${err?.message ?? String(err)}`);
    } finally {
      setEmailBusy(false);
      setTimeout(() => setEmailToast(null), 3500);
    }
  }

  /* ── Content area (changes with view, tab bar stays) ── */
  function renderContent() {
    if (view.kind === "studio" && studioProject) {
      return (
        <Studio
          story={studioProject}
          setStory={(u: any) => updateProject(studioProject.id, u)}
          moments={moments}
          onBack={() => setView({ kind: "main" })}
          isNew={(view as any).isNew ?? false}
          onCreateProjectFromDraft={(newStory) => {
            setProjects(ps => [newStory, ...ps]);
            if (user) saveProjectToDB(user.id, newStory);
            setView({ kind: "studio", projectId: newStory.id, isNew: true });
          }}
          onDeleteProject={() => {
            const id = studioProject.id;
            setProjects(ps => ps.filter(p => p.id !== id));
            deleteProjectFromDB(id);
            setView({ kind: "main" });
          }}
          autosaveEnabled={autosaveEnabled}
          onEmailProject={() => openEmailSheet(studioProject)}
          emailProjectBusy={emailBusy}
        />
      );
    }

    // Main view
    return (
      <>
        <div className="topbar topbar-dark">
          <button
            className="topbar-btn"
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <span className={`menu-toggle ${menuOpen ? "open" : ""}`}>
              <span /><span /><span />
            </span>
          </button>
          <div className="topbar-center">
            <img src="/logo.svg" alt="Unfold" className="brand-logo-img" />
          </div>
          <div style={{ width: 44 }} />
        </div>
        <div className="screen-scroll" key={mainTab}>
          <div className="page-enter">
            {mainTab === "projects" && (
              <ProjectsTab
                projects={projects}
                onOpen={(id) => setView({ kind: "studio", projectId: id })}
                onNew={openCreateModal}
              />
            )}
            {mainTab === "moments" && (
              <MomentsTab
                moments={moments}
                onEdit={(m) => setEditingMoment(m)}
                onNew={() => {
                  setNewIdeaText("");
                  setNewIdeaType("scene");
                  setNewIdeaOpen(true);
                }}
              />
            )}
          </div>
        </div>
      </>
    );
  }

  return (
   <WriterProfileContext.Provider value={profileAPI}>
    <div className="app">
      {renderContent()}

      {/* Tab bar — hidden when inside a project */}
      <nav className={`tabbar ${view.kind === "studio" ? "tabbar-hidden" : ""}`}>
        <div className="tabbar-inner">
          <button
            className={`tab ${view.kind === "main" && mainTab === "projects" ? "active" : ""}`}
            onClick={() => { setView({ kind: "main" }); setMainTab("projects"); }}
          >
            <span className="icon">
              <img src={view.kind === "main" && mainTab === "projects" ? "/project-icon-active.svg" : "/project-icon-inactive.svg"} alt="" />
            </span>
            PROJECTS
          </button>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <button
              className={`record-fab ${recording ? "recording" : ""}`}
              onClick={startRecording}
              aria-label="Record a moment"
            >
              <div className="red-dot" />
            </button>
            <div className="record-label">REC</div>
          </div>

          <button
            className={`tab ${view.kind === "main" && mainTab === "moments" ? "active" : ""}`}
            onClick={() => { setView({ kind: "main" }); setMainTab("moments"); }}
          >
            <span className="icon">
              <img src={view.kind === "main" && mainTab === "moments" ? "/ideas-icon-active.svg" : "/ideas-icon-inactive.svg"} alt="" />
            </span>
            IDEAS
          </button>
        </div>
      </nav>

      {/* Menu panel — drops down from the top nav. Topbar (z:30) stays
          visible above the panel (z:25), and the panel covers the bottom
          tabbar (z:20). Primary items on top; account row + autosave
          collapsed at the bottom. */}
      <div className={`menu-panel ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
        <div className="menu-panel-inner">
          <div className="menu-panel-list">
            {/* Static menu items. The "Email me this project" CTA used to
                live here as a contextual item when a studio project was
                open, but it's been moved into the Settings panel so the
                menu stays stable regardless of context. */}
            {(() => {
              interface MenuItem {
                icon: React.ReactNode;
                label: string;
                onClick: () => void;
                disabled?: boolean;
              }
              const items: MenuItem[] = [
                {
                  icon: <IconZap />,
                  label: "AI Connections",
                  onClick: () => setMenuOpen(false),
                },
              ];
              return items.map((item, i) => (
                <button
                  key={item.label}
                  className="menu-panel-item"
                  style={{ ["--d" as any]: `${60 + i * 50}ms`, opacity: item.disabled ? 0.55 : 1 }}
                  onClick={item.onClick}
                  disabled={item.disabled}
                >
                  {item.icon}
                  <span className="label">{item.label}</span>
                  <span className="arrow">›</span>
                </button>
              ));
            })()}
          </div>

          <div className="menu-panel-spacer" />

          {/* Account row — email left, Sign out right, above the autosave divider */}
          {user && (
            <div
              className="menu-panel-account-row"
              style={{ ["--d" as any]: "200ms" }}
            >
              <span className="menu-panel-account-email">{user.email}</span>
              <button
                className="menu-panel-account-signout"
                onClick={() => { setMenuOpen(false); signOut(); }}
              >
                Sign out
              </button>
            </div>
          )}

          {/* Deprioritized autosave — small utility row, no caption.
              Its top border is the divider that sits below the email row. */}
          <div
            className="menu-panel-utility"
            style={{ ["--d" as any]: "250ms" }}
            onClick={() => setAutosaveEnabled(!autosaveEnabled)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setAutosaveEnabled(!autosaveEnabled);
              }
            }}
          >
            <span className="label">Autosave edits</span>
            <button
              type="button"
              className={`toggle-switch toggle-switch-dark ${autosaveEnabled ? "on" : ""}`}
              aria-label="Toggle autosave"
              aria-pressed={autosaveEnabled}
              onClick={(e) => {
                e.stopPropagation();
                setAutosaveEnabled(!autosaveEnabled);
              }}
            >
              <span className="toggle-switch-knob" />
            </button>
          </div>
        </div>
      </div>

      {/* New Idea sheet — shares the IdeaFields body with the Record and
          View Idea sheets so all three read as the same view. The only
          visual difference between this sheet and the Record sheet is
          the record FAB + live caption that the Record sheet slots into
          the top of IdeaFields. Heading "What's the idea?" lives inside
          the body. */}
      <div
        className={`sheet-backdrop ${newIdeaOpen ? "open" : ""}`}
        onClick={() => {
          setNewIdeaOpen(false);
          setNewIdeaText("");
          setNewIdeaType("scene");
        }}
      />
      <div className={`sheet ${newIdeaOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <div className="display heading" style={{ marginTop: 25, marginBottom: 25 }}>
            What&rsquo;s the idea?
          </div>

          <IdeaFields
            text={newIdeaText}
            setText={setNewIdeaText}
            type={newIdeaType}
            setType={setNewIdeaType}
            autoFocus
            hideCleanUp
          />

          {/* Clean up + Save sit side-by-side in the action row. Clean up
              rewrites newIdeaText in place via cleanUpIdeaText; Save commits
              the draft moment and closes the sheet. Tags were removed from
              this sheet per user request. */}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <Button
              variant="secondary"
              size="lg"
              onClick={async () => {
                if (!newIdeaText.trim() || newIdeaCleaning) return;
                setNewIdeaCleaning(true);
                try {
                  const cleaned = await cleanUpIdeaText(newIdeaText, profileAPI.profile);
                  if (cleaned) setNewIdeaText(cleaned);
                } finally {
                  setNewIdeaCleaning(false);
                }
              }}
              disabled={newIdeaCleaning || !newIdeaText.trim()}
              style={{ flex: 1 }}
            >
              {newIdeaCleaning ? "Cleaning…" : "\u2728 Clean up"}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                const text = newIdeaText.trim();
                if (!text) return;
                saveDraftMoment(text, newIdeaType, []);
                setNewIdeaOpen(false);
                setNewIdeaText("");
                setNewIdeaType("scene");
              }}
              disabled={!newIdeaText.trim()}
              style={{ flex: 1 }}
            >
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Recording sheet — identical to the New Idea sheet (same shared
          IdeaFields body), with the red record FAB + live-status caption
          slotted at the top via the recordSlot prop. While actively
          recording, the sheet is locked: backdrop is non-dismissive and
          the Close button is hidden. User must stop the recording (tap
          the red FAB) or Save to leave. Prevents the mic from silently
          continuing to listen after the sheet closes. */}
      <div className={`sheet-backdrop ${recordSheetOpen ? "open" : ""}`}
        onClick={() => { if (recording) return; setRecordSheetOpen(false); }} />
      <div className={`sheet ${recordSheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <div className="display heading" style={{ marginTop: 25, marginBottom: 25 }}>
            What&rsquo;s the idea?
          </div>

          <IdeaFields
            text={liveTranscript}
            setText={setLiveTranscript}
            type={recordType}
            setType={setRecordType}
            tags={recordTags}
            setTags={setRecordTags}
            recordSlot={
              <>
                <div style={{ display: "flex", justifyContent: "center", padding: "19px 0 0" }}>
                  <button
                    className={`record-fab ${recording ? "recording" : ""}`}
                    onClick={() => recording ? stopRecording() : startRecording()}
                    style={{ position: "static", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}
                  >
                    <div className="red-dot" />
                  </button>
                </div>
                <div className="caption" style={{ textAlign: "center", marginTop: 8, marginBottom: 18 }}>
                  {recording ? "Listening… tap to stop" : "Tap to record, or type below"}
                </div>
              </>
            }
          />

          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => {
              const text = liveTranscript.trim();
              if (!text) return;
              saveDraftMoment(text, recordType, recordTags);
            }}
            disabled={!liveTranscript.trim()}
            style={{ marginTop: 14 }}
          >
            Save Idea
          </Button>
        </div>
      </div>

      {/* View Idea sheet — same body as the New Idea sheet (shared
          IdeaFields), minus the heading. The top-right slot holds a
          Delete button. (The voice play / SpeakButton was removed per
          request — ideas stay silent in the composer/viewer.) */}
      <div className={`sheet-backdrop ${!!editingMoment ? "open" : ""}`}
        onClick={() => setEditingMoment(null)} />
      <div className={`sheet ${!!editingMoment ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header" style={{ justifyContent: "flex-end" }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { if (editingMoment) deleteMoment(editingMoment.id); }}
            style={{ color: "var(--record)", borderColor: "var(--record)" }}
          >
            Delete
          </Button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          {editingMoment && (
            <MomentEditForm
              moment={editingMoment}
              onUpdate={(patch) => { updateMoment(editingMoment.id, patch); setEditingMoment({ ...editingMoment, ...patch }); }}
            />
          )}
        </div>
      </div>

      {/* ── Project creation modal ── */}
      <div className={`create-modal-backdrop ${createOpen ? "open" : ""}`} onClick={closeCreateModal} />
      <div className={`create-modal ${createOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header create-modal-header">
          {/* Elevated step indicator — centered in the header, no cancel button.
              Completed steps show a checkmark; upcoming/active render an empty
              node (no numbers). */}
          <div className="create-stepper create-stepper-compact" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={createStep + 1}>
            {(["Format", "Title", "Genre"] as const).map((name, i) => {
              const state = i < createStep ? "done" : i === createStep ? "active" : "upcoming";
              return (
                <div key={name} className={`create-step create-step-${state}`}>
                  <div className="create-step-node">
                    {state === "done" && (
                      <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className="create-step-label">{name}</div>
                  {i < 2 && <div className="create-step-track" aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        </div>
        <div className="create-modal-body">
          {createDraft && createStep === 0 && (
            <CreateStepFormat
              draft={createDraft}
              setDraft={updateDraft}
              touched={createFormatTouched}
              onTouch={() => setCreateFormatTouched(true)}
            />
          )}
          {createDraft && createStep === 1 && (
            <CreateStepTitle draft={createDraft} setDraft={updateDraft} />
          )}
          {createDraft && createStep === 2 && (
            <CreateStepGenre draft={createDraft} setDraft={updateDraft} />
          )}
        </div>
        <div className="create-modal-footer">
          <div className="create-modal-actions">
            {createStep > 0 && (
              <Button variant="secondary" size="lg" onClick={() => setCreateStep(s => s - 1)}
                style={{ minWidth: 96 }}>
                Back
              </Button>
            )}
            {createStep < 2 ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => setCreateStep(s => s + 1)}
                // Each step gates Continue: Format must be actively chosen,
                // Title must be non-empty.
                disabled={
                  (createStep === 0 && !createFormatTouched) ||
                  (createStep === 1 && !createDraft?.title?.trim())
                }
                style={{ flex: 1 }}
              >
                Continue
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={finishCreate}
                // Step 2 requires title + at least one selected genre.
                disabled={
                  !createDraft?.title?.trim() ||
                  (createDraft ? getActiveConceptDraft(createDraft).settings.genres.length === 0 : true)
                }
                style={{ flex: 1 }}
              >
                Create Project
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Success toast */}
      <div className={`toast ${toastVisible ? "show" : ""}`}>Idea Added</div>
      {/* Email-send toast — sits on the same CSS track as the idea toast
          but is keyed on its own state so they can't stomp each other.
          Content is dynamic ("Sending…" / "Sent to …" / "Failed to send: …"). */}
      <div className={`toast ${emailToast ? "show" : ""}`} style={{ bottom: 78 }}>
        {emailToast}
      </div>

      {/* ── Email project picker sheet ──
          Bottom-sheet with attachment checkboxes. Active rows (PDF,
          Fountain, JSON) drive the real request; "Coming soon" rows
          are placeholders for features we'll build next (audio,
          storyboard prompts, storyboard sketches, collaborator
          email). Same .sheet / .sheet-backdrop plumbing as New Idea
          and Update Other Layers — visual consistency matters because
          this is the user's first exposure to the feature roadmap. */}
      <div
        className={`sheet-backdrop ${emailSheetStory ? "open" : ""}`}
        onClick={closeEmailSheet}
      />
      <div className={`sheet layer-update-sheet ${emailSheetStory ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <div className="display heading" style={{ marginTop: 25, marginBottom: 8 }}>
            Email this project
          </div>
          <div className="caption" style={{ marginBottom: 20 }}>
            {user?.email ? (
              <>Sending to <strong>{user.email}</strong></>
            ) : (
              "Sign in to send"
            )}
          </div>

          <div className="caption" style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-ghost)",
            marginBottom: 6,
          }}>
            What to include
          </div>

          {/* Active attachment rows — real toggles. */}
          <label className="layer-update-row">
            <input
              type="checkbox"
              checked={emailInclude.pdf}
              onChange={() => setEmailInclude(v => ({ ...v, pdf: !v.pdf }))}
              disabled={emailBusy}
            />
            <span className="layer-update-row-label">
              Screenplay PDF
            </span>
          </label>
          <label className="layer-update-row">
            <input
              type="checkbox"
              checked={emailInclude.fountain}
              onChange={() => setEmailInclude(v => ({ ...v, fountain: !v.fountain }))}
              disabled={emailBusy}
            />
            <span className="layer-update-row-label">
              Fountain file (.fountain)
            </span>
          </label>
          <label className="layer-update-row">
            <input
              type="checkbox"
              checked={emailInclude.json}
              onChange={() => setEmailInclude(v => ({ ...v, json: !v.json }))}
              disabled={emailBusy}
            />
            <span className="layer-update-row-label">
              Project JSON backup
            </span>
          </label>

          {/* Coming-soon placeholders. These exist to:
                1. Signal the roadmap to users
                2. Keep visual real-estate reserved so adding them later
                   doesn't feel like a layout jump
              They never toggle and never submit — the input is
              permanently disabled and unchecked. */}
          {[
            "Audio readings (.mp3)",
            "Midjourney storyboard prompts",
            "Storyboard sketches",
          ].map(label => (
            <label key={label} className="layer-update-row email-placeholder-row">
              <input type="checkbox" checked={false} disabled readOnly />
              <span className="layer-update-row-label">{label}</span>
              <span className="email-coming-soon">Coming soon</span>
            </label>
          ))}

          <div className="caption" style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-ghost)",
            margin: "22px 0 6px",
          }}>
            Send to
          </div>
          <label className="layer-update-row email-placeholder-row">
            <input type="checkbox" checked={false} disabled readOnly />
            <span className="layer-update-row-label">
              Collaborator email
            </span>
            <span className="email-coming-soon">Coming soon</span>
          </label>

          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => {
              if (!emailSheetStory) return;
              void sendProjectBundleEmail(emailSheetStory, emailInclude);
            }}
            disabled={
              emailBusy ||
              !user?.email ||
              (!emailInclude.pdf && !emailInclude.fountain && !emailInclude.json)
            }
            style={{ marginTop: 22 }}
          >
            {emailBusy
              ? "Sending…"
              : `Send (${
                  (emailInclude.pdf ? 1 : 0) +
                  (emailInclude.fountain ? 1 : 0) +
                  (emailInclude.json ? 1 : 0)
                })`}
          </Button>
        </div>
      </div>
    </div>
   </WriterProfileContext.Provider>
  );
}

/* ============================================ */
/* ============ IDEA FORM FIELDS ============== */
/* ============================================ */

// Canonical idea types. The Record sheet, New Idea sheet, and View/Edit
// sheet all share the IdeaFields body below and pull from this list.
const MOMENT_TYPES: Moment["type"][] = ["scene","dialogue","joke","memory","character","image","note","dream"];

// AI-cleans a raw idea text. Streams /api/generate with a placeholder
// story payload and pulls the "text" field out of the JSON response.
async function cleanUpIdeaText(raw: string, profile?: WriterProfile | null): Promise<string | null> {
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        story: { id: "", title: "", projectType: "feature", conceptDrafts: [{ id: "cd", number: 1, createdAt: "", updatedAt: "", logline: "", settings: { framework: "three-act", genres: [], vibe: "", unpredictability: 5, darkness: 5, pace: 5, endingTypes: [] }, concept: { summary: "", tone: "", themes: [] } }], charactersDrafts: [{ id: "chd", number: 1, createdAt: "", updatedAt: "", characters: [] }], storyDrafts: [{ id: "sd", number: 1, createdAt: "", updatedAt: "", beats: [], ingredients: [], snippets: [] }], scriptDrafts: [{ id: "scd", number: 1, createdAt: "", updatedAt: "", script: { scenes: [], syncStatus: "synced" } }], projectDrafts: [{ id: "pd", number: 1, createdAt: "", updatedAt: "", conceptDraftId: "cd", charactersDraftId: "chd", storyDraftId: "sd", scriptDraftId: "scd" }], activeProjectDraftId: "pd", counters: { concept: 1, characters: 1, story: 1, script: 1, project: 1 }, updatedAt: "" },
        action: { type: "clean_moment", payload: { rawText: raw } },
        profile,
      }),
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try { const msg = JSON.parse(line); if (msg.type === "text") full += msg.value; } catch {}
      }
    }
    const match = full.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.text) return parsed.text as string;
    }
    return null;
  } catch { return null; }
}

// Shared idea body — used by the New Idea, Record, and View/Edit sheets
// so all three experiences read as the same view. Type chips + textarea +
// Clean up + Tags. Optional record FAB at the top for the Record sheet.
// Persistence + mode-specific actions (Save, Delete) live in the parent.
function IdeaFields({
  text, setText,
  type, setType,
  tags, setTags,
  autoFocus,
  recordSlot,
  hideCleanUp,
}: {
  text: string;
  setText: (v: string) => void;
  type: Moment["type"];
  setType: (t: Moment["type"]) => void;
  tags?: string[];
  setTags?: (t: string[]) => void;
  autoFocus?: boolean;
  /** Optional node rendered at the very top — used by the Record sheet
   *  to slot the red record FAB + status caption above the shared body. */
  recordSlot?: React.ReactNode;
  /** When true, suppresses the block Clean-up button inside this body.
   *  The New Idea sheet uses this so Clean-up can live alongside Save
   *  in the sheet's action row instead of above it. */
  hideCleanUp?: boolean;
}) {
  const [cleaning, setCleaning] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const { profile } = useProfileCapture();

  async function runCleanUp() {
    if (!text.trim()) return;
    setCleaning(true);
    try {
      const cleaned = await cleanUpIdeaText(text, profile);
      if (cleaned) setText(cleaned);
    } finally {
      setCleaning(false);
    }
  }

  function addTag() {
    if (!setTags || !tags) return;
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  }
  function removeTag(tag: string) {
    if (!setTags || !tags) return;
    setTags(tags.filter(t => t !== tag));
  }

  return (
    <>
      {recordSlot}

      <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>Type</span>
      <div className="chip-row sheet-selector-row" style={{ marginBottom: 16 }}>
        {MOMENT_TYPES.map(t => (
          <Selector key={t} selected={type === t} onClick={() => setType(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Selector>
        ))}
      </div>

      <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>Idea</span>
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="A line, a scene, a joke, a memory…"
        rows={6}
        autoFocus={autoFocus}
      />

      {!hideCleanUp && (
        <Button
          variant="secondary"
          size="lg"
          block
          onClick={runCleanUp}
          disabled={cleaning || !text.trim()}
          style={{ marginTop: 14 }}
        >
          {cleaning ? "Cleaning…" : "\u2728 Clean up"}
        </Button>
      )}

      {tags && setTags && (
        <>
          <div className="eyebrow" style={{ marginTop: 16, marginBottom: 8 }}>Tags</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Input
              size="compact"
              placeholder="Add tag"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTag()}
              style={{ flex: 1 }}
            />
            <Button variant="secondary" size="sm" onClick={addTag}>+</Button>
          </div>
          {tags.length > 0 && (
            <div className="chip-row" style={{ marginTop: 8 }}>
              {tags.map(t => (
                <Selector
                  key={t}
                  selected
                  onClick={() => removeTag(t)}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  {t} ✕
                </Selector>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ============================================ */
/* ============ MOMENT EDIT FORM ============== */
/* ============================================ */

// Used inside the View Idea sheet. Delegates everything to the shared
// IdeaFields component (tags now live inside IdeaFields).
//
// Save model: explicit. Local state holds the in-progress edits; the
// Save button commits them to the parent via onUpdate only when the
// user taps it. The button is disabled (gray) while the local state
// matches the incoming moment, and only lights up once something has
// actually changed. Closing the sheet without saving discards the
// in-progress edits — consistent with every other explicit-save sheet
// in the app.
function MomentEditForm({
  moment, onUpdate,
}: {
  moment: Moment;
  onUpdate: (patch: Partial<Moment>) => void;
}) {
  const [text, setText] = useState(moment.text);
  const [type, setType] = useState(moment.type);
  const [tags, setTags] = useState<string[]>(moment.tags);

  // If the user opens a different idea without closing the sheet in
  // between (or the parent pushes a fresh moment after Save), re-seed
  // local state so the form matches what's on screen.
  useEffect(() => {
    setText(moment.text);
    setType(moment.type);
    setTags(moment.tags);
  }, [moment.id, moment.text, moment.type, moment.tags]);

  const tagsDiffer =
    tags.length !== moment.tags.length ||
    tags.some((t, i) => t !== moment.tags[i]);
  const isDirty = text !== moment.text || type !== moment.type || tagsDiffer;

  return (
    <div className="stack">
      <IdeaFields
        text={text}
        setText={setText}
        type={type}
        setType={setType}
        tags={tags}
        setTags={setTags}
      />
      <Button
        variant="primary"
        size="lg"
        block
        onClick={() => { if (isDirty) onUpdate({ text, type, tags }); }}
        disabled={!isDirty}
        style={{ marginTop: 14 }}
      >
        Save
      </Button>
    </div>
  );
}

/* ============================================ */
/* ============ PROJECTS TAB ================== */
/* ============================================ */

/* Animated three-card poster stack for the Projects empty state.
   Holds a permutation of poster indices mapped to three fixed slots
   (back-left, back-right, front). Every 4s the permutation rotates
   by one, and CSS transitions smoothly slide each poster into its
   new slot. Front slot renders with the highest z-index. */
const POSTER_SRCS = ["/poster1.png", "/poster2.png", "/poster3.png"];
const POSTER_SLOTS = [
  // slot 0: back-left — pulled inward so the front card noticeably
  // overlaps it (centers ~65px off-midline, poster is 150px wide).
  { x: -62, y: 6, rot: -7, z: 1 },
  // slot 1: back-right — mirror of back-left.
  { x: 62, y: 6, rot: 7, z: 1 },
  // slot 2: front-center — sits on top, offset down just enough to
  // let the top edges of the back cards peek out.
  { x: 0, y: 38, rot: 0, z: 3 },
];
function EmptyPosterStack() {
  // order[i] = which poster index occupies slot i. The shuffle is
  // disabled for now — restore by uncommenting the useEffect below.
  const [order /* , setOrder */] = useState<number[]>([0, 1, 2]);
  // useEffect(() => {
  //   const id = setInterval(() => {
  //     setOrder((prev) => [prev[2], prev[0], prev[1]]);
  //   }, 4000);
  //   return () => clearInterval(id);
  // }, []);
  // Pre-compute each poster's current slot so we can key by stable
  // poster index (keeps <img> mounted across reorders, which is what
  // lets the transition play).
  const slotFor = (posterIdx: number) => order.indexOf(posterIdx);
  return (
    <div className="projects-empty-art" aria-hidden>
      {POSTER_SRCS.map((src, posterIdx) => {
        const slotIdx = slotFor(posterIdx);
        const slot = POSTER_SLOTS[slotIdx];
        return (
          <div
            key={posterIdx}
            className="empty-poster"
            style={{
              transform: `translate(-50%, 0) translate(${slot.x}px, ${slot.y}px) rotate(${slot.rot}deg)`,
              zIndex: slot.z,
            }}
          >
            <img src={src} alt="" draggable={false} />
          </div>
        );
      })}
    </div>
  );
}

function ProjectsTab({
  projects, onOpen, onNew,
}: {
  projects: Story[];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  // First-run empty state — shown until the user has created their very
  // first project. Swaps back to the standard header + list layout as
  // soon as `projects` has at least one entry.
  if (projects.length === 0) {
    return (
      <div className="projects-empty">
        <EmptyPosterStack />
        <h1 className="projects-empty-title">Your story starts here</h1>
        <p className="projects-empty-sub">
          Begin with an idea, shape the world around it,<br />and watch your story unfold.
        </p>
        <Button variant="primary" size="lg" onClick={onNew} style={{ minWidth: 180 }}>
          GET STARTED
        </Button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20, marginTop: 40 }}>
        <div className="display">Projects</div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onNew}
          icon={<img src="/add-icon.svg" alt="" style={{ width: 9, height: 9 }} />}
          style={{ transform: "translateY(-3px)", background: "#fff" }}
        >
          New Project
        </Button>
      </div>

      {projects.map(p => {
        const c = getActiveConceptDraft(p);
        return (
          <button key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
            <div className="project-cover">
              {p.thumbnail ? (
                <img src={p.thumbnail} alt="" className="project-cover-img" />
              ) : (
                <span className="project-cover-initial">
                  {p.title ? p.title.charAt(0).toUpperCase() : "?"}
                </span>
              )}
            </div>
            <div className="project-body">
              <div className="project-title">{p.title || "Untitled"}</div>
              <div className="project-genre">
                {/* .attr-pill matches the collapsed-state genre chips in
                    the Concept tab on the Project Detail page. */}
                {c.settings.genres?.length > 0 && c.settings.genres.map((g: string) => (
                  <span key={g} className="attr-pill">{g.toUpperCase()}</span>
                ))}
                <span className="attr-pill">
                  {c.settings.framework.replace(/-/g, " ").toUpperCase()}
                </span>
              </div>
              <div className="project-summary">{c.logline || "No logline yet"}</div>
            </div>
          </button>
        );
      })}
    </>
  );
}

/* ============================================ */
/* ============ MOMENTS TAB =================== */
/* ============================================ */

const MOMENT_FILTERS = ["All", "Scene", "Dialogue", "Joke", "Memory", "Character", "Image", "Note", "Dream"] as const;

function MomentsTab({
  moments,
  onEdit,
  onNew,
}: {
  moments: Moment[];
  onEdit: (m: Moment) => void;
  onNew: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("All");

  const filtered = moments.filter(m => {
    if (filter !== "All" && m.type !== filter.toLowerCase()) return false;
    if (search && !m.text.toLowerCase().includes(search.toLowerCase()) &&
        !m.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  function formatTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20, marginTop: 40 }}>
        <div className="display">Ideas</div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onNew}
          icon={<img src="/add-icon.svg" alt="" style={{ width: 9, height: 9 }} />}
          style={{ transform: "translateY(-3px)", background: "#fff" }}
        >
          New Idea
        </Button>
      </div>

      <div className="search-bar">
        <IconSearch />
        <input
          placeholder="Search moments"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {/* Note: the `.search-bar` icon+input compound keeps its bespoke wrapper
          because the layout is "icon inline with input". The styling intent
          (minimalistic gray, fade-on-focus) matches <Input size="standard">. */}

      <div className="filter-row">
        {MOMENT_FILTERS.map(f => (
          <button
            key={f}
            className={`filter-pill ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--ink-mute)", fontSize: 14 }}>
          {search || filter !== "All"
            ? "No ideas match your filter."
            : "Tap New Idea above, or the red record button below, to capture your first idea."}
        </div>
      )}

      {filtered.map(m => (
        <div
          key={m.id}
          className="card moment-item"
          onClick={() => onEdit(m)}
          style={{ cursor: "pointer", marginBottom: 12 }}
        >
          <div className="moment-type">{m.type}</div>
          <div className="moment-text">{m.text}</div>
          {m.tags.length > 0 && (
            <div className="moment-tags">
              {m.tags.map(t => <span key={t} className="moment-tag">{t}</span>)}
            </div>
          )}
          <div className="moment-time">{formatTime(m.createdAt)}</div>
        </div>
      ))}
    </>
  );
}

/* ============================================ */
/* ========= PROJECT CREATION STEPS ========== */
/* ============================================ */

const PROJECT_TYPES: { value: ProjectType; title: string; sub: string }[] = [
  { value: "feature",  title: "Feature Film", sub: "90-120 min. Full story arc." },
  { value: "short",    title: "Short Film",   sub: "Under 40 min. Tight & focused." },
  { value: "tv-show",  title: "TV Show",      sub: "Episodes. Serialized story." },
];
const ALL_GENRES: Genre[] = ["thriller","drama","comedy","horror","sci-fi","romance","action","mystery"];

function CreateStepFormat({
  draft, setDraft, touched, onTouch,
}: {
  draft: Story;
  setDraft: (u: (s: Story) => Story) => void;
  touched: boolean;
  onTouch: () => void;
}) {
  const storyLayer = getActiveStoryLayerDraft(draft);
  return (
    <>
      <div className="display heading" style={{ marginTop: 25 }}>What are you making?</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 25 }}>
        {PROJECT_TYPES.map(pt => (
          <button
            key={pt.value}
            // Only render the "selected" style once the user has explicitly
            // tapped a format — prevents the default "feature" from looking
            // pre-chosen before the user has engaged with the step.
            className={`choice ${touched && draft.projectType === pt.value ? "selected" : ""}`}
            onClick={() => {
              setDraft(s => ({ ...s, projectType: pt.value }));
              onTouch();
            }}
            style={{ textAlign: "left" }}
          >
            <div className="choice-title">{pt.title}</div>
            <div className="choice-sub">{pt.sub}</div>
          </button>
        ))}
      </div>
      {draft.projectType === "tv-show" && (
        <div style={{ marginTop: 16 }}>
          <div className="caption" style={{ marginBottom: 8 }}>How many episodes to start with?</div>
          <Input
            type="number"
            min={1}
            max={24}
            placeholder="e.g. 8"
            value={storyLayer.episodes?.length ?? ""}
            onChange={e => {
              const count = Math.max(1, Math.min(24, parseInt(e.target.value) || 1));
              setDraft(s => {
                // We need updateStoryLayerDraft here but it's not imported; do it via direct patch
                return {
                  ...s,
                  storyDrafts: s.storyDrafts.map(d =>
                    d.id === getActiveStoryLayerDraft(s).id
                      ? {
                          ...d,
                          episodes: Array.from({ length: count }, (_, i) => ({
                            id: `ep_${i + 1}`,
                            title: `Episode ${i + 1}`,
                            number: i + 1,
                            beats: [],
                          })),
                          updatedAt: new Date().toISOString(),
                        }
                      : d
                  ),
                  updatedAt: new Date().toISOString(),
                };
              });
            }}
          />
        </div>
      )}
    </>
  );
}

function CreateStepTitle({
  draft, setDraft,
}: {
  draft: Story;
  setDraft: (u: (s: Story) => Story) => void;
}) {
  return (
    <>
      <div className="display heading">Let{"'"}s name it.</div>
      <div style={{ marginTop: 25 }}>
        <Input
          placeholder="The Quiet Room"
          value={draft.title}
          onChange={e => setDraft(s => ({ ...s, title: e.target.value }))}
          autoFocus
        />
      </div>
    </>
  );
}

function CreateStepGenre({
  draft, setDraft,
}: {
  draft: Story;
  setDraft: (u: (s: Story) => Story) => void;
}) {
  const conceptDraft = getActiveConceptDraft(draft);
  const toggleGenre = (g: Genre) => {
    setDraft(s => {
      const ad = getActiveConceptDraft(s);
      const current = ad.settings.genres;
      const next = current.includes(g)
        ? current.filter(x => x !== g)
        : [...current, g];
      return updateConceptDraft(s, { settings: { ...ad.settings, genres: next } });
    });
  };

  return (
    <>
      <div className="display heading">Set the genre.</div>
      <div className="chip-row" style={{ marginTop: 25 }}>
        {ALL_GENRES.map(g => (
          <Selector
            key={g}
            selected={conceptDraft.settings.genres.includes(g)}
            onClick={() => toggleGenre(g)}
          >
            {g}
          </Selector>
        ))}
      </div>
      {conceptDraft.settings.genres.length > 1 && (
        <div className="caption" style={{ marginTop: 12 }}>
          Blend: {conceptDraft.settings.genres.join(" + ")}
        </div>
      )}
    </>
  );
}
