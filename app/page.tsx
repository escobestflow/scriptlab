"use client";

import { useEffect, useRef, useState } from "react";
import { Story } from "@/lib/story";
import { Moment } from "@/lib/sampleData";
import {
  loadProjects, saveProjects, newBlankProject,
  loadMoments, saveMoments,
} from "@/lib/storage";
import { Wizard } from "@/components/Wizard";
import { Studio } from "@/components/Studio";

type View =
  | { kind: "main" }
  | { kind: "wizard"; draft: Story }
  | { kind: "studio"; projectId: string };

type MainTab = "projects" | "moments";

/* ======= SVG Icons (inline, no deps) ======= */
const IconMenu = () => (
  <svg viewBox="0 0 24 24"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>
);
const IconFolder = () => (
  <svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
);
const IconStar = () => (
  <svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 16.4 5.7 21l2.3-7-6-4.6h7.6z"/></svg>
);
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
  const [projects, setProjects] = useState<Story[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [view, setView] = useState<View>({ kind: "main" });
  const [mainTab, setMainTab] = useState<MainTab>("projects");
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    setProjects(loadProjects());
    setMoments(loadMoments());
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) saveProjects(projects); }, [projects, hydrated]);
  useEffect(() => { if (hydrated) saveMoments(moments); }, [moments, hydrated]);

  const updateProject = (id: string, u: (s: Story) => Story) =>
    setProjects(ps => ps.map(p => p.id === id ? { ...u(p), updatedAt: new Date().toISOString() } : p));

  // ── Voice capture ──
  function toggleRecord() {
    const SR: any =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SR) {
      // Fallback: open text input sheet for manual entry
      const text = prompt("Type your moment:");
      if (text?.trim()) {
        addMoment(text.trim(), "scene");
      }
      return;
    }
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    let captured = "";
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) captured += e.results[i][0].transcript + " ";
      }
    };
    rec.onend = () => {
      setRecording(false);
      if (captured.trim()) addMoment(captured.trim(), "scene");
    };
    rec.onerror = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  }

  function addMoment(text: string, type: Moment["type"]) {
    const m: Moment = {
      id: "m_" + Math.random().toString(36).slice(2),
      text,
      type,
      tags: [],
      createdAt: new Date().toISOString(),
    };
    setMoments(prev => [m, ...prev]);
    setMainTab("moments");
  }

  function projectProgress(p: Story): number {
    // Simple heuristic: title + logline + characters + ingredients + beats
    let score = 0;
    if (p.title) score += 10;
    if (p.logline) score += 10;
    score += Math.min(p.characters.length * 10, 20);
    score += Math.min(p.ingredients.length * 5, 15);
    score += Math.min(p.beats.length * 3, 45);
    return Math.min(score, 100);
  }

  if (!hydrated) return <div className="app" />;

  /* ── WIZARD ── */
  if (view.kind === "wizard") {
    return (
      <div className="app">
        <Wizard
          draft={(view as any).draft}
          setDraft={(u: any) => setView(v => v.kind === "wizard" ? { ...v, draft: u(v.draft) } : v)}
          onCancel={() => setView({ kind: "main" })}
          onFinish={() => {
            const saved = (view as any).draft;
            setProjects(ps => [saved, ...ps]);
            setView({ kind: "studio", projectId: saved.id });
          }}
        />
      </div>
    );
  }

  /* ── STUDIO ── */
  if (view.kind === "studio") {
    const project = projects.find(p => p.id === (view as any).projectId);
    if (!project) { setView({ kind: "main" }); return null; }
    return (
      <div className="app">
        <Studio
          story={project}
          setStory={(u: any) => updateProject(project.id, u)}
          onBack={() => setView({ kind: "main" })}
        />
      </div>
    );
  }

  /* ── MAIN VIEW (Projects / Moments) ── */
  return (
    <div className="app">
      {/* Top bar */}
      <div className="topbar">
        <button className="topbar-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
          <IconMenu />
        </button>
        <div className="topbar-center">ScriptLab</div>
        <div style={{ width: 44 }} />
      </div>

      {/* Content */}
      <div className="screen-scroll" key={mainTab}>
        <div className="page-enter">
          {mainTab === "projects" && (
            <ProjectsTab
              projects={projects}
              onOpen={(id) => setView({ kind: "studio", projectId: id })}
              onNew={() => setView({ kind: "wizard", draft: newBlankProject() })}
              progress={projectProgress}
            />
          )}
          {mainTab === "moments" && (
            <MomentsTab moments={moments} />
          )}
        </div>
      </div>

      {/* Tab bar with centered Record FAB */}
      <nav className="tabbar">
        <div className="tabbar-inner">
          <button className={`tab ${mainTab === "projects" ? "active" : ""}`} onClick={() => setMainTab("projects")}>
            <span className="icon"><IconFolder /></span>
            Projects
          </button>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <button
              className={`record-fab ${recording ? "recording" : ""}`}
              onClick={toggleRecord}
              aria-label="Record a moment"
            >
              <div className="red-dot" />
            </button>
            <div className="record-label">Record</div>
          </div>

          <button className={`tab ${mainTab === "moments" ? "active" : ""}`} onClick={() => setMainTab("moments")}>
            <span className="icon"><IconStar /></span>
            Moments
          </button>
        </div>
      </nav>

      {/* Menu drawer */}
      <div
        className={`menu-backdrop ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <div className={`menu-drawer ${menuOpen ? "open" : ""}`}>
        <div className="menu-header">ScriptLab</div>
        {[
          { icon: <IconSettings />, label: "Settings" },
          { icon: <IconUser />, label: "Account" },
          { icon: <IconZap />, label: "AI Connections" },
          { icon: <IconExport />, label: "Export Scripts" },
        ].map(item => (
          <button key={item.label} className="menu-item" onClick={() => setMenuOpen(false)}>
            {item.icon}
            <span className="label">{item.label}</span>
            <span className="arrow">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================ */
/* ============ PROJECTS TAB ================== */
/* ============================================ */

function ProjectsTab({
  projects, onOpen, onNew, progress,
}: {
  projects: Story[];
  onOpen: (id: string) => void;
  onNew: () => void;
  progress: (p: Story) => number;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        <div className="display">Projects</div>
        <button className="btn-secondary" onClick={onNew} style={{ fontSize: 13 }}>
          + New
        </button>
      </div>

      {projects.map(p => {
        const pct = progress(p);
        return (
          <button key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
            <div className="project-thumb">
              {p.title ? p.title.charAt(0).toUpperCase() : "?"}
            </div>
            <div className="project-info">
              <div className="project-title">{p.title || "Untitled"}</div>
              <div className="project-genre">
                <span className="genre-pill">{p.settings.genre}</span>
                <span className="genre-pill">{p.settings.framework.replace(/-/g, " ")}</span>
              </div>
              <div className="project-summary">{p.logline || "No logline yet"}</div>
              <div className="progress-bar">
                <div className="fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="project-arrow">›</div>
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

function MomentsTab({ moments }: { moments: Moment[] }) {
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
        <div key={m.id} className="moment-card">
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
