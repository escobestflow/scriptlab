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
  // New project creation modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [createDraft, setCreateDraft] = useState<Story | null>(null);
  const recognitionRef = useRef<any>(null);
  const capturedRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load data from Supabase when user is authenticated
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

  function saveDraftMoment(text: string, type: Moment["type"]) {
    const m: Moment = {
      id: "m_" + Math.random().toString(36).slice(2),
      text,
      type,
      tags: [],
      createdAt: new Date().toISOString(),
    };
    setMoments(prev => [m, ...prev]);
    if (user) saveMomentToDB(user.id, m);
    setRecordSheetOpen(false);
    setLiveTranscript("");
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

  // ── Auth loading ──
  if (authLoading) {
    return (
      <div className="app" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="caption">Loading…</div>
      </div>
    );
  }

  // ── Login screen ──
  if (!user) {
    return (
      <div className="app" style={{ alignItems: "center", justifyContent: "center", padding: "0 40px", textAlign: "center" }}>
        <div style={{ marginBottom: 8 }}>
          <img src="/logo.svg" alt="Unfold" style={{ width: 86, height: 18.5 }} />
        </div>
        <div className="display" style={{ marginBottom: 8 }}>
          Your stories,{"\n"}structured.
        </div>
        <div className="caption" style={{ marginBottom: 32, maxWidth: 260 }}>
          Design scripts for film, TV, and shorts — guided by AI and your raw creative moments.
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={signInWithGoogle}
          style={{ width: "100%", maxWidth: 280 }}
          icon={
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "#fff" }}>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          }
        >
          Sign in with Google
        </Button>
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
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setCreateDraft(null);
    setCreateStep(0);
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
        />
      );
    }

    // Main view
    return (
      <>
        <div className="topbar topbar-dark">
          <button className="topbar-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
            <img src="/menu-icon.svg" alt="" style={{ width: 22, height: 15 }} />
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
              <MomentsTab moments={moments} onEdit={(m) => setEditingMoment(m)} />
            )}
          </div>
        </div>
      </>
    );
  }

  return (
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

      {/* Menu drawer */}
      <div
        className={`menu-backdrop ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <div className={`menu-drawer ${menuOpen ? "open" : ""}`}>
        <div className="menu-header">
          <img src="/logo.svg" alt="Unfold" style={{ width: 86, height: 18.5 }} />
        </div>
        {user && (
          <div style={{ fontSize: 13, color: "var(--ink-mute)", marginBottom: 16 }}>
            {user.email}
          </div>
        )}
        {/* Autosave toggle — replaces the old "Settings" stub row.
            Inline iOS-style toggle keeps menu flat; no sub-sheet needed. */}
        <div
          className="menu-item menu-item-toggle"
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
          <IconSettings />
          <div className="menu-item-text">
            <div className="label">Autosave edits</div>
            <div className="menu-item-caption">
              Saves drafts as you type. Turn off to use manual save buttons.
            </div>
          </div>
          <button
            type="button"
            className={`toggle-switch ${autosaveEnabled ? "on" : ""}`}
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
        {[
          { icon: <IconZap />, label: "AI Connections" },
          { icon: <IconExport />, label: "Export Scripts" },
        ].map(item => (
          <button key={item.label} className="menu-item" onClick={() => setMenuOpen(false)}>
            {item.icon}
            <span className="label">{item.label}</span>
            <span className="arrow">›</span>
          </button>
        ))}
        <button className="menu-item" onClick={() => { setMenuOpen(false); signOut(); }}
          style={{ marginTop: 16, borderTop: "1px solid var(--border)", color: "var(--ink-mute)" }}>
          <IconUser />
          <span className="label">Sign out</span>
        </button>
      </div>

      {/* Recording sheet */}
      <div className={`sheet-backdrop ${recordSheetOpen ? "open" : ""}`}
        onClick={() => { stopRecording(); setRecordSheetOpen(false); }} />
      <div className={`sheet ${recordSheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">{recording ? "Recording…" : "New moment"}</div>
          <Button variant="secondary" size="sm" onClick={() => { stopRecording(); setRecordSheetOpen(false); }}>Close</Button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <RecordingForm
            liveTranscript={liveTranscript}
            setLiveTranscript={setLiveTranscript}
            recording={recording}
            onToggleRecord={() => recording ? stopRecording() : startRecording()}
            onSave={saveDraftMoment}
          />
        </div>
      </div>

      {/* Moment edit sheet */}
      <div className={`sheet-backdrop ${!!editingMoment ? "open" : ""}`}
        onClick={() => setEditingMoment(null)} />
      <div className={`sheet ${!!editingMoment ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">Edit moment</div>
          <Button variant="secondary" size="sm" onClick={() => setEditingMoment(null)}>Close</Button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          {editingMoment && (
            <MomentEditForm
              moment={editingMoment}
              onUpdate={(patch) => { updateMoment(editingMoment.id, patch); setEditingMoment({ ...editingMoment, ...patch }); }}
              onDelete={() => deleteMoment(editingMoment.id)}
              onClose={() => setEditingMoment(null)}
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
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            <CreateStepFormat draft={createDraft} setDraft={updateDraft} />
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
              <Button variant="primary" size="lg" onClick={() => setCreateStep(s => s + 1)}
                style={{ flex: 1 }}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={finishCreate}
                disabled={!createDraft?.title?.trim()}
                style={{ flex: 1 }}>
                Create Project
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Success toast */}
      <div className={`toast ${toastVisible ? "show" : ""}`}>Moment added!</div>
    </div>
  );
}

/* ============================================ */
/* ============ RECORDING FORM ================ */
/* ============================================ */

const MOMENT_TYPES: Moment["type"][] = ["scene","dialogue","joke","memory","character","image"];

function RecordingForm({
  liveTranscript, setLiveTranscript, recording, onToggleRecord, onSave,
}: {
  liveTranscript: string;
  setLiveTranscript: (v: string) => void;
  recording: boolean;
  onToggleRecord: () => void;
  onSave: (text: string, type: Moment["type"]) => void;
}) {
  const [type, setType] = useState<Moment["type"]>("scene");
  const [cleaning, setCleaning] = useState(false);

  async function cleanUp() {
    if (!liveTranscript.trim()) return;
    setCleaning(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story: { id: "", title: "", projectType: "feature", conceptDrafts: [{ id: "cd", number: 1, createdAt: "", updatedAt: "", logline: "", settings: { framework: "three-act", genres: [], vibe: "", unpredictability: 5, darkness: 5, pace: 5, endingTypes: [] }, concept: { summary: "", tone: "", themes: [] } }], charactersDrafts: [{ id: "chd", number: 1, createdAt: "", updatedAt: "", characters: [] }], storyDrafts: [{ id: "sd", number: 1, createdAt: "", updatedAt: "", beats: [], ingredients: [], snippets: [] }], scriptDrafts: [{ id: "scd", number: 1, createdAt: "", updatedAt: "", script: { scenes: [], syncStatus: "synced" } }], projectDrafts: [{ id: "pd", number: 1, createdAt: "", updatedAt: "", conceptDraftId: "cd", charactersDraftId: "chd", storyDraftId: "sd", scriptDraftId: "scd" }], activeProjectDraftId: "pd", counters: { concept: 1, characters: 1, story: 1, script: 1, project: 1 }, updatedAt: "" },
          action: { type: "clean_moment", payload: { rawText: liveTranscript } },
        }),
      });
      if (!res.ok || !res.body) return;
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
      try {
        const match = full.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.text) setLiveTranscript(parsed.text);
        }
      } catch {}
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="stack">
      <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
        <button
          className={`record-fab ${recording ? "recording" : ""}`}
          onClick={onToggleRecord}
          style={{ position: "static", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}
        >
          <div className="red-dot" />
        </button>
      </div>
      <div className="caption" style={{ textAlign: "center", marginBottom: 4 }}>
        {recording ? "Listening… tap to stop" : "Tap to record, or type below"}
      </div>

      <Textarea placeholder="Your moment…"
        value={liveTranscript} onChange={e => setLiveTranscript(e.target.value)} rows={4} />

      {liveTranscript.trim() && (
        <>
          {/* Clean up — associated with the text above */}
          <Button variant="secondary" size="lg" block onClick={cleanUp} disabled={cleaning}>
            {cleaning ? "Cleaning…" : "✨ Clean up with AI"}
          </Button>

          {/* Type picker */}
          <div className="eyebrow" style={{ marginTop: 8 }}>Type</div>
          <div className="chip-row">
            {MOMENT_TYPES.map(t => (
              <Selector key={t} selected={type === t} onClick={() => setType(t)}>
                {t}
              </Selector>
            ))}
          </div>

          <Button variant="primary" size="lg" block style={{ marginTop: 12 }}
            onClick={() => onSave(liveTranscript.trim(), type)}>
            Save moment
          </Button>
        </>
      )}
    </div>
  );
}

/* ============================================ */
/* ============ MOMENT EDIT FORM ============== */
/* ============================================ */

function MomentEditForm({
  moment, onUpdate, onDelete, onClose,
}: {
  moment: Moment;
  onUpdate: (patch: Partial<Moment>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(moment.text);
  const [type, setType] = useState(moment.type);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(moment.tags);
  const [cleaning, setCleaning] = useState(false);

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      const next = [...tags, t];
      setTags(next);
      onUpdate({ tags: next });
    }
    setTagInput("");
  }
  function removeTag(tag: string) {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    onUpdate({ tags: next });
  }

  async function cleanUp() {
    if (!text.trim()) return;
    setCleaning(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story: { id: "", title: "", projectType: "feature", conceptDrafts: [{ id: "cd", number: 1, createdAt: "", updatedAt: "", logline: "", settings: { framework: "three-act", genres: [], vibe: "", unpredictability: 5, darkness: 5, pace: 5, endingTypes: [] }, concept: { summary: "", tone: "", themes: [] } }], charactersDrafts: [{ id: "chd", number: 1, createdAt: "", updatedAt: "", characters: [] }], storyDrafts: [{ id: "sd", number: 1, createdAt: "", updatedAt: "", beats: [], ingredients: [], snippets: [] }], scriptDrafts: [{ id: "scd", number: 1, createdAt: "", updatedAt: "", script: { scenes: [], syncStatus: "synced" } }], projectDrafts: [{ id: "pd", number: 1, createdAt: "", updatedAt: "", conceptDraftId: "cd", charactersDraftId: "chd", storyDraftId: "sd", scriptDraftId: "scd" }], activeProjectDraftId: "pd", counters: { concept: 1, characters: 1, story: 1, script: 1, project: 1 }, updatedAt: "" },
          action: { type: "clean_moment", payload: { rawText: text } },
        }),
      });
      if (!res.ok || !res.body) return;
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
      try {
        const match = full.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.text) { setText(parsed.text); onUpdate({ text: parsed.text }); }
        }
      } catch {}
    } finally { setCleaning(false); }
  }

  return (
    <div className="stack">
      <Textarea value={text} rows={5}
        onChange={e => { setText(e.target.value); onUpdate({ text: e.target.value }); }} />

      <div className="eyebrow">Type</div>
      <div className="chip-row">
        {MOMENT_TYPES.map(t => (
          <Selector key={t} selected={type === t}
            onClick={() => { setType(t); onUpdate({ type: t }); }}>
            {t}
          </Selector>
        ))}
      </div>

      <div className="eyebrow" style={{ marginTop: 8 }}>Tags</div>
      <div style={{ display: "flex", gap: 8 }}>
        <Input size="compact" placeholder="Add tag" value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTag()}
          style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={addTag}>+</Button>
      </div>
      {tags.length > 0 && (
        <div className="chip-row" style={{ marginTop: 4 }}>
          {tags.map(t => (
            <Selector key={t} selected onClick={() => removeTag(t)}
              style={{ fontSize: 11, padding: "4px 10px" }}>
              {t} ✕
            </Selector>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button variant="secondary" size="lg" block onClick={cleanUp} disabled={cleaning}>
          {cleaning ? "Cleaning…" : "✨ Clean up"}
        </Button>
      </div>

      <Button variant="secondary" size="lg" block
        style={{ color: "var(--record)", borderColor: "var(--record)", marginTop: 4 }}
        onClick={onDelete}>
        Delete moment
      </Button>
    </div>
  );
}

/* ============================================ */
/* ============ PROJECTS TAB ================== */
/* ============================================ */

function ProjectsTab({
  projects, onOpen, onNew,
}: {
  projects: Story[];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20, marginTop: 40 }}>
        <div className="display">Projects</div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onNew}
          icon={<img src="/add-icon.svg" alt="" style={{ width: 9, height: 9 }} />}
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
                {/* Non-interactive spans styled as .ds-selector — matches
                    the Concept-tab genre chips exactly. The parent button
                    owns the click target. */}
                {c.settings.genres?.length > 0 && c.settings.genres.map((g: string) => (
                  <span key={g} className="ds-selector">{g}</span>
                ))}
                <span className="ds-selector">{c.settings.framework.replace(/-/g, " ")}</span>
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

const MOMENT_FILTERS = ["All", "Scene", "Dialogue", "Joke", "Memory", "Character", "Image"] as const;

function MomentsTab({ moments, onEdit }: { moments: Moment[]; onEdit: (m: Moment) => void }) {
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
      <div className="display" style={{ marginBottom: 16 }}>Moments</div>

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
            ? "No moments match your filter."
            : "Tap the red button to capture your first moment."}
        </div>
      )}

      {filtered.map(m => (
        <div key={m.id} className="moment-card" onClick={() => onEdit(m)} style={{ cursor: "pointer" }}>
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
  draft, setDraft,
}: {
  draft: Story;
  setDraft: (u: (s: Story) => Story) => void;
}) {
  const storyLayer = getActiveStoryLayerDraft(draft);
  return (
    <>
      <div className="display heading">What are you making?</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
        {PROJECT_TYPES.map(pt => (
          <button
            key={pt.value}
            className={`choice ${draft.projectType === pt.value ? "selected" : ""}`}
            onClick={() => setDraft(s => ({ ...s, projectType: pt.value }))}
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
      <Input
        placeholder="The Quiet Room"
        value={draft.title}
        onChange={e => setDraft(s => ({ ...s, title: e.target.value }))}
        autoFocus
      />
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
      <div className="chip-row" style={{ marginTop: 8 }}>
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
