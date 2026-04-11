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
  const [recordSheetOpen, setRecordSheetOpen] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [editingMoment, setEditingMoment] = useState<Moment | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const recognitionRef = useRef<any>(null);
  const capturedRef = useRef("");

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
    setRecordSheetOpen(false);
    setLiveTranscript("");
    // Show toast
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  function updateMoment(id: string, patch: Partial<Moment>) {
    setMoments(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  }

  function deleteMoment(id: string) {
    setMoments(prev => prev.filter(m => m.id !== id));
    setEditingMoment(null);
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

  const studioProject = view.kind === "studio"
    ? projects.find(p => p.id === (view as any).projectId) ?? null
    : null;

  // If studio project not found, fall back
  if (view.kind === "studio" && !studioProject) {
    setView({ kind: "main" });
    return <div className="app" />;
  }

  /* ── Content area (changes with view, tab bar stays) ── */
  function renderContent() {
    if (view.kind === "wizard") {
      return (
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
      );
    }

    if (view.kind === "studio" && studioProject) {
      return (
        <Studio
          story={studioProject}
          setStory={(u: any) => updateProject(studioProject.id, u)}
          moments={moments}
          onBack={() => setView({ kind: "main" })}
        />
      );
    }

    // Main view
    return (
      <>
        <div className="topbar">
          <button className="topbar-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
            <IconMenu />
          </button>
          <div className="topbar-center">
            <img src="/logo.svg" alt="ScriptLab" style={{ height: 32, width: 32 }} />
          </div>
          <div style={{ width: 44 }} />
        </div>
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

      {/* Tab bar — ALWAYS visible */}
      <nav className="tabbar">
        <div className="tabbar-inner">
          <button
            className={`tab ${view.kind === "main" && mainTab === "projects" ? "active" : ""}`}
            onClick={() => { setView({ kind: "main" }); setMainTab("projects"); }}
          >
            <span className="icon"><IconFolder /></span>
            Projects
          </button>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <button
              className={`record-fab ${recording ? "recording" : ""}`}
              onClick={startRecording}
              aria-label="Record a moment"
            >
              <div className="red-dot" />
            </button>
            <div className="record-label">Record</div>
          </div>

          <button
            className={`tab ${view.kind === "main" && mainTab === "moments" ? "active" : ""}`}
            onClick={() => { setView({ kind: "main" }); setMainTab("moments"); }}
          >
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
        <div className="menu-header">
          <img src="/logo.svg" alt="ScriptLab" style={{ height: 40, width: 40 }} />
        </div>
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

      {/* Recording sheet */}
      <div className={`sheet-backdrop ${recordSheetOpen ? "open" : ""}`}
        onClick={() => { stopRecording(); setRecordSheetOpen(false); }} />
      <div className={`sheet ${recordSheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">{recording ? "Recording…" : "New moment"}</div>
          <button className="chip" onClick={() => { stopRecording(); setRecordSheetOpen(false); }}>Close</button>
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
          <button className="chip" onClick={() => setEditingMoment(null)}>Close</button>
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
          story: { id: "", title: "", logline: "", projectType: "feature", settings: { framework: "three-act", genres: [], vibe: "", unpredictability: 5, darkness: 5, pace: 5, endingTypes: [] }, characters: [], ingredients: [], snippets: [], beats: [], updatedAt: "" },
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

      <textarea className="field" placeholder="Your moment…"
        value={liveTranscript} onChange={e => setLiveTranscript(e.target.value)} rows={4} />

      {liveTranscript.trim() && (
        <>
          {/* Clean up — associated with the text above */}
          <button className="btn-secondary" onClick={cleanUp} disabled={cleaning}
            style={{ fontSize: 13, width: "100%" }}>
            {cleaning ? "Cleaning…" : "✨ Clean up with AI"}
          </button>

          {/* Type picker */}
          <div className="eyebrow" style={{ marginTop: 8 }}>Type</div>
          <div className="chip-row">
            {MOMENT_TYPES.map(t => (
              <button key={t} className={`chip ${type === t ? "selected" : ""}`}
                onClick={() => setType(t)} style={{ fontSize: 12, padding: "8px 14px" }}>
                {t}
              </button>
            ))}
          </div>

          <button className="btn-primary" style={{ marginTop: 12, fontSize: 14 }}
            onClick={() => onSave(liveTranscript.trim(), type)}>
            Save moment
          </button>
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
          story: { id: "", title: "", logline: "", projectType: "feature", settings: { framework: "three-act", genres: [], vibe: "", unpredictability: 5, darkness: 5, pace: 5, endingTypes: [] }, characters: [], ingredients: [], snippets: [], beats: [], updatedAt: "" },
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
      <textarea className="field" value={text} rows={5}
        onChange={e => { setText(e.target.value); onUpdate({ text: e.target.value }); }} />

      <div className="eyebrow">Type</div>
      <div className="chip-row">
        {MOMENT_TYPES.map(t => (
          <button key={t} className={`chip ${type === t ? "selected" : ""}`}
            onClick={() => { setType(t); onUpdate({ type: t }); }}
            style={{ fontSize: 12, padding: "8px 14px" }}>
            {t}
          </button>
        ))}
      </div>

      <div className="eyebrow" style={{ marginTop: 8 }}>Tags</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="field" placeholder="Add tag" value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTag()}
          style={{ flex: 1, fontSize: 13, padding: "10px 12px" }} />
        <button className="btn-secondary" onClick={addTag}
          style={{ fontSize: 12, padding: "8px 14px", minHeight: 0 }}>+</button>
      </div>
      {tags.length > 0 && (
        <div className="chip-row" style={{ marginTop: 4 }}>
          {tags.map(t => (
            <button key={t} className="chip selected" style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => removeTag(t)}>
              {t} ✕
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-secondary" onClick={cleanUp} disabled={cleaning}
          style={{ flex: 1, fontSize: 13 }}>
          {cleaning ? "Cleaning…" : "✨ Clean up"}
        </button>
      </div>

      <button className="btn-secondary"
        style={{ color: "var(--record)", borderColor: "var(--record)", fontSize: 13, marginTop: 4 }}
        onClick={onDelete}>
        Delete moment
      </button>
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
                {(p.settings as any).genres?.length > 0
                  ? (p.settings as any).genres.map((g: string) => <span key={g} className="genre-pill">{g}</span>)
                  : (p.settings as any).genre && <span className="genre-pill">{(p.settings as any).genre}</span>
                }
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
