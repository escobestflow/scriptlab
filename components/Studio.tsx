"use client";

import { useRef, useState } from "react";
import { Story, Beat, Episode } from "@/lib/story";
import { Moment } from "@/lib/sampleData";
import { ActionRequest } from "@/lib/prompt";

type Section = "design" | "execute";

export function Studio({
  story,
  setStory,
  moments,
  onBack,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  moments: Moment[];
  onBack: () => void;
}) {
  const [section, setSection] = useState<Section>("design");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTitle, setSheetTitle] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBeatId, setPickerBeatId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [beatTrayOpen, setBeatTrayOpen] = useState(false);
  const [beatTrayInsertAt, setBeatTrayInsertAt] = useState<number | null>(null);
  // TV show episode drill-in
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);

  // Determine which beats we're editing
  const isTV = story.projectType === "tv-show";
  const activeEpisode = isTV ? story.episodes?.find(ep => ep.id === activeEpisodeId) : null;
  const beats = isTV
    ? (activeEpisode?.beats ?? [])
    : story.beats;
  const setBeats = (updater: (bs: Beat[]) => Beat[]) => {
    if (isTV && activeEpisodeId) {
      setStory(s => ({
        ...s,
        episodes: s.episodes?.map(ep =>
          ep.id === activeEpisodeId ? { ...ep, beats: updater(ep.beats) } : ep
        ),
      }));
    } else {
      setStory(s => ({ ...s, beats: updater(s.beats) }));
    }
  };

  async function run(action: ActionRequest, title: string) {
    if (busy) return;
    setBusy(true);
    setOutput("");
    setSheetTitle(title);
    setSheetOpen(true);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, action }),
      });
      if (!res.ok || !res.body) {
        setOutput("Error: " + (await res.text()));
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "text") {
              fullText += msg.value;
              setOutput(p => p + msg.value);
            }
            else if (msg.type === "error") setOutput(p => p + "\n[error] " + msg.value);
          } catch {}
        }
      }

      if (action.type === "generate_scene" && action.payload.beatIndex != null) {
        const idx = action.payload.beatIndex;
        setBeats(bs => bs.map((b, i) =>
          i === idx ? { ...b, status: "written" as const, sceneContent: fullText } : b
        ));
      }
    } finally {
      setBusy(false);
    }
  }

  // Beat management
  function addBeat(name: string, summary: string, insertAt?: number) {
    const newBeat: Beat = {
      id: "b_" + Math.random().toString(36).slice(2),
      name, summary, purpose: "",
      position: 0, momentIds: [], status: "design",
    };
    setBeats(bs => {
      const idx = insertAt != null ? insertAt : bs.length;
      const updated = [...bs];
      updated.splice(idx, 0, newBeat);
      return updated.map((b, i) => ({ ...b, position: i }));
    });
  }

  function updateBeat(id: string, patch: Partial<Beat>) {
    setBeats(bs => bs.map(b => b.id === id ? { ...b, ...patch } : b));
  }

  function moveBeat(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    setBeats(bs => {
      const arr = [...bs];
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr.map((b, i) => ({ ...b, position: i }));
    });
  }

  function removeBeat(id: string) {
    setBeats(bs => bs.filter(b => b.id !== id).map((b, i) => ({ ...b, position: i })));
  }

  function linkMoment(beatId: string, momentId: string) {
    setBeats(bs => bs.map(b =>
      b.id === beatId && !b.momentIds.includes(momentId)
        ? { ...b, momentIds: [...b.momentIds, momentId] }
        : b
    ));
    setPickerOpen(false);
    setPickerBeatId(null);
  }

  function unlinkMoment(beatId: string, momentId: string) {
    setBeats(bs => bs.map(b =>
      b.id === beatId
        ? { ...b, momentIds: b.momentIds.filter(id => id !== momentId) }
        : b
    ));
  }

  // Back handler
  function handleBack() {
    if (showSetup) { setShowSetup(false); return; }
    if (isTV && activeEpisodeId) { setActiveEpisodeId(null); return; }
    onBack();
  }

  // TV Show episode view
  if (isTV && !activeEpisodeId && !showSetup) {
    return (
      <>
        <ProjectHeader
          story={story}
          onBack={onBack}
          onSetup={() => setShowSetup(true)}
          subtitle={`${story.episodes?.length ?? 0} episodes`}
        />
        <div className="section-tabs">
          <button className="section-tab active">Episodes</button>
        </div>
        <div className="screen-scroll">
          <div className="page-enter">
            {(story.episodes ?? []).map(ep => (
              <button
                key={ep.id}
                className="project-card"
                onClick={() => setActiveEpisodeId(ep.id)}
                style={{ width: "100%", textAlign: "left" }}
              >
                <div className="project-thumb" style={{ width: 42, height: 42, borderRadius: 12, fontSize: 14 }}>
                  {ep.number}
                </div>
                <div className="project-info">
                  <div className="project-title">{ep.title}</div>
                  <div className="caption">{ep.beats.length} beats</div>
                </div>
                <div className="project-arrow">›</div>
              </button>
            ))}
            <button className="btn-secondary" style={{ width: "100%", marginTop: 12 }}
              onClick={() => {
                setStory(s => ({
                  ...s,
                  episodes: [
                    ...(s.episodes ?? []),
                    {
                      id: "ep_" + Math.random().toString(36).slice(2),
                      title: `Episode ${(s.episodes?.length ?? 0) + 1}`,
                      number: (s.episodes?.length ?? 0) + 1,
                      beats: [],
                    },
                  ],
                }));
              }}>
              + Add episode
            </button>
          </div>
        </div>
      </>
    );
  }

  // Setup view
  if (showSetup) {
    return (
      <>
        <ProjectHeader
          story={story}
          onBack={() => setShowSetup(false)}
          subtitle="Setup"
        />
        <div className="screen-scroll">
          <div className="page-enter">
            <ConfigureTab story={story} setStory={setStory} />
          </div>
        </div>
      </>
    );
  }

  const sorted = [...beats].sort((a, b) => a.position - b.position);

  return (
    <>
      <ProjectHeader
        story={story}
        onBack={handleBack}
        onSetup={() => setShowSetup(true)}
        subtitle={isTV && activeEpisode ? activeEpisode.title : undefined}
      />

      {/* Section tabs at top */}
      <div className="section-tabs">
        <button className={`section-tab ${section === "design" ? "active" : ""}`}
          onClick={() => setSection("design")}>Design</button>
        <button className={`section-tab ${section === "execute" ? "active" : ""}`}
          onClick={() => setSection("execute")}>Execute</button>
      </div>

      <div className="screen-scroll" key={section}>
        <div className="page-enter">
          {section === "design" && (
            <DesignTab
              beats={sorted}
              moments={moments}
              addBeat={addBeat}
              updateBeat={updateBeat}
              moveBeat={moveBeat}
              removeBeat={removeBeat}
              unlinkMoment={unlinkMoment}
              openMomentPicker={(id) => { setPickerBeatId(id); setPickerOpen(true); }}
              openBeatTray={(insertAt) => { setBeatTrayInsertAt(insertAt); setBeatTrayOpen(true); }}
              run={run}
              busy={busy}
            />
          )}
          {section === "execute" && (
            <ExecuteTab beats={sorted} run={run} busy={busy} />
          )}
        </div>
      </div>

      {/* Streaming output sheet */}
      <div className={`sheet-backdrop ${sheetOpen ? "open" : ""}`} onClick={() => setSheetOpen(false)} />
      <div className={`sheet ${sheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">{sheetTitle}</div>
          <button className="chip" onClick={() => setSheetOpen(false)}>Close</button>
        </div>
        <div className={`sheet-body ${!output ? "placeholder" : ""}`}>
          {output || (busy ? "Thinking…" : "Nothing here yet.")}
        </div>
      </div>

      {/* Moment picker sheet */}
      <div className={`sheet-backdrop ${pickerOpen ? "open" : ""}`}
        onClick={() => { setPickerOpen(false); setPickerBeatId(null); }} />
      <div className={`sheet ${pickerOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">Link a moment</div>
          <button className="chip" onClick={() => { setPickerOpen(false); setPickerBeatId(null); }}>Close</button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <MomentPicker
            moments={moments}
            linkedIds={pickerBeatId ? (beats.find(b => b.id === pickerBeatId)?.momentIds ?? []) : []}
            onLink={(mid) => pickerBeatId && linkMoment(pickerBeatId, mid)}
          />
        </div>
      </div>

      {/* Beat creation tray */}
      <div className={`sheet-backdrop ${beatTrayOpen ? "open" : ""}`}
        onClick={() => setBeatTrayOpen(false)} />
      <div className={`sheet ${beatTrayOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">New beat</div>
          <button className="chip" onClick={() => setBeatTrayOpen(false)}>Close</button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <BeatCreationForm
            story={story}
            onSave={(name, summary) => {
              addBeat(name, summary, beatTrayInsertAt ?? undefined);
              setBeatTrayOpen(false);
              setBeatTrayInsertAt(null);
            }}
            busy={busy}
          />
        </div>
      </div>
    </>
  );
}

/* ============================================ */
/* ============ PROJECT HEADER ================ */
/* ============================================ */

function ProjectHeader({
  story, onBack, onSetup, subtitle,
}: {
  story: Story;
  onBack: () => void;
  onSetup?: () => void;
  subtitle?: string;
}) {
  return (
    <div className="topbar">
      <button className="topbar-btn" onClick={onBack} aria-label="Back">
        <svg viewBox="0 0 24 24" style={{width:22,height:22,stroke:"currentColor",strokeWidth:1.8,fill:"none"}}>
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div style={{ textAlign: "center", flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-0.01em" }}>
          {story.title || "Untitled"}
        </div>
        {subtitle && <div className="caption">{subtitle}</div>}
      </div>
      {onSetup ? (
        <button className="topbar-btn" onClick={onSetup} aria-label="Setup">
          <svg viewBox="0 0 24 24" style={{width:20,height:20,stroke:"currentColor",strokeWidth:1.6,fill:"none"}}>
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </button>
      ) : (
        <div style={{ width: 44 }} />
      )}
    </div>
  );
}

/* ============================================ */
/* ============ DESIGN TAB ==================== */
/* ============================================ */

function DesignTab({
  beats, moments, addBeat, updateBeat, moveBeat, removeBeat,
  unlinkMoment, openMomentPicker, openBeatTray, run, busy,
}: {
  beats: Beat[];
  moments: Moment[];
  addBeat: (name: string, summary: string, insertAt?: number) => void;
  updateBeat: (id: string, patch: Partial<Beat>) => void;
  moveBeat: (index: number, direction: "up" | "down") => void;
  removeBeat: (id: string) => void;
  unlinkMoment: (beatId: string, momentId: string) => void;
  openMomentPicker: (beatId: string) => void;
  openBeatTray: (insertAt: number) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ beatId: string; field: "name" | "summary" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartY = useRef(0);
  const beatRefs = useRef<(HTMLDivElement | null)[]>([]);

  function startEdit(beatId: string, field: "name" | "summary", currentValue: string) {
    setEditingField({ beatId, field });
    setEditValue(currentValue);
  }
  function saveEdit() {
    if (editingField) {
      updateBeat(editingField.beatId, { [editingField.field]: editValue });
      setEditingField(null);
    }
  }

  return (
    <>
      {beats.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>◆</div>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>No beats yet</div>
          <div className="caption" style={{ marginBottom: 16 }}>
            Start building your story structure — add your first beat.
          </div>
          <button className="btn-primary" style={{ fontSize: 14, padding: "14px 22px", minHeight: 0 }}
            onClick={() => openBeatTray(0)}>
            + Add beat
          </button>
        </div>
      )}

      {beats.map((beat, i) => {
        const isExpanded = expanded === beat.id;
        const linkedMoments = beat.momentIds
          .map(id => moments.find(m => m.id === id))
          .filter(Boolean) as Moment[];
        const isDragging = draggingIdx === i;

        return (
          <div key={beat.id} ref={el => { beatRefs.current[i] = el; }}>
            <div
              className={`beat-card ${isExpanded ? "expanded" : ""} ${isDragging ? "dragging" : ""}`}
            >
              <div className="beat-header" style={{ display: "flex", alignItems: "center", gap: 0 }}>
                {/* Drag grip */}
                <button
                  className="beat-grip"
                  aria-label="Drag to reorder"
                  onTouchStart={(e) => {
                    touchStartY.current = e.touches[0].clientY;
                    longPressTimer.current = setTimeout(() => {
                      setDraggingIdx(i);
                      setExpanded(null);
                    }, 300);
                  }}
                  onTouchMove={(e) => {
                    if (longPressTimer.current) {
                      clearTimeout(longPressTimer.current);
                      longPressTimer.current = null;
                    }
                    if (draggingIdx == null) return;
                    e.preventDefault();
                    const y = e.touches[0].clientY;
                    const delta = y - touchStartY.current;
                    // Check if we've moved enough to swap
                    if (Math.abs(delta) > 50) {
                      if (delta > 0 && draggingIdx < beats.length - 1) {
                        moveBeat(draggingIdx, "down");
                        setDraggingIdx(draggingIdx + 1);
                        touchStartY.current = y;
                      } else if (delta < 0 && draggingIdx > 0) {
                        moveBeat(draggingIdx, "up");
                        setDraggingIdx(draggingIdx - 1);
                        touchStartY.current = y;
                      }
                    }
                  }}
                  onTouchEnd={() => {
                    if (longPressTimer.current) {
                      clearTimeout(longPressTimer.current);
                      longPressTimer.current = null;
                    }
                    setDraggingIdx(null);
                  }}
                  onMouseDown={() => setDraggingIdx(i)}
                  onMouseUp={() => setDraggingIdx(null)}
                >
                  ⠿
                </button>
                <button
                  style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, padding: "16px 16px 16px 4px", textAlign: "left", background: "none", border: "none" }}
                  onClick={() => setExpanded(isExpanded ? null : beat.id)}
                >
                <div className={`beat-number ${beat.status === "written" ? "written" : ""}`}>
                  {i + 1}
                </div>
                <div className="beat-info">
                  <div className="beat-name">{beat.name || "Untitled beat"}</div>
                  {!isExpanded && (
                    <div className="beat-summary-preview">{beat.summary || "No summary"}</div>
                  )}
                </div>
                {beat.momentIds.length > 0 && (
                  <span className="caption" style={{ flexShrink: 0 }}>
                    {beat.momentIds.length}m
                  </span>
                )}
                <span className="beat-expand">›</span>
                </button>
              </div>

              {isExpanded && (
                <div className="beat-body">
                  {/* Editable name */}
                  <div className="beat-section-label">Name</div>
                  {editingField?.beatId === beat.id && editingField.field === "name" ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="field" value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={e => e.key === "Enter" && saveEdit()}
                        autoFocus
                        style={{ fontSize: 14, padding: "10px 12px" }} />
                    </div>
                  ) : (
                    <div className="beat-text" onClick={() => startEdit(beat.id, "name", beat.name)}
                      style={{ cursor: "text" }}>
                      {beat.name || <span className="beat-text muted">Tap to edit</span>}
                    </div>
                  )}

                  {/* Editable summary */}
                  <div className="beat-section-label">Summary</div>
                  {editingField?.beatId === beat.id && editingField.field === "summary" ? (
                    <textarea className="field" value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={saveEdit}
                      autoFocus rows={4}
                      style={{ fontSize: 14, padding: "10px 12px" }} />
                  ) : (
                    <div className="beat-text" onClick={() => startEdit(beat.id, "summary", beat.summary)}
                      style={{ cursor: "text" }}>
                      {beat.summary || <span className="beat-text muted">Tap to edit</span>}
                    </div>
                  )}

                  {beat.purpose && (
                    <>
                      <div className="beat-section-label">Purpose</div>
                      <div className="beat-text">{beat.purpose}</div>
                    </>
                  )}

                  <div className="beat-section-label">Linked moments · {linkedMoments.length}</div>
                  {linkedMoments.length > 0 ? (
                    <div className="beat-moments">
                      {linkedMoments.map(m => (
                        <div key={m.id} className="linked-moment">
                          <div className="moment-type-dot" />
                          <div className="moment-preview">{m.text}</div>
                          <button className="btn-icon" style={{ width: 28, height: 28, fontSize: 14 }}
                            onClick={() => unlinkMoment(beat.id, m.id)} aria-label="Unlink">✕</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="caption">No moments linked.</div>
                  )}

                  <div className="beat-actions">
                    <button className="btn-secondary" style={{ fontSize: 12, padding: "8px 14px", minHeight: 0 }}
                      onClick={() => openMomentPicker(beat.id)}>+ Link moment</button>
                    <button className="btn-secondary"
                      style={{ fontSize: 12, padding: "8px 14px", minHeight: 0, color: "var(--ink-mute)" }}
                      onClick={() => removeBeat(beat.id)}>Remove</button>
                  </div>

                  <div className="beat-reorder">
                    <button className="reorder-btn" disabled={i === 0}
                      onClick={() => moveBeat(i, "up")} aria-label="Move up">↑</button>
                    <button className="reorder-btn" disabled={i === beats.length - 1}
                      onClick={() => moveBeat(i, "down")} aria-label="Move down">↓</button>
                  </div>
                </div>
              )}
            </div>

            {/* Inline + button between beats */}
            <div className="beat-insert-row">
              <button
                className="beat-insert-btn"
                onClick={() => openBeatTray(i + 1)}
                aria-label="Insert beat here"
              >
                +
              </button>
            </div>
          </div>
        );
      })}

    </>
  );
}

/* ============================================ */
/* ============ EXECUTE TAB =================== */
/* ============================================ */

function ExecuteTab({
  beats, run, busy,
}: {
  beats: Beat[];
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
}) {
  const writtenCount = beats.filter(b => b.status === "written").length;

  return (
    <>
      <div className="caption" style={{ marginBottom: 14 }}>
        {writtenCount}/{beats.length} beats written.
      </div>

      {beats.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
          <div className="caption">No beats yet. Go to <b>Design</b> to structure first.</div>
        </div>
      )}

      {beats.map((beat, i) => (
        <div key={beat.id} className="beat-card">
          <div className="beat-header" style={{ cursor: "default" }}>
            <div className={`beat-number ${beat.status === "written" ? "written" : ""}`}>{i + 1}</div>
            <div className="beat-info">
              <div className="beat-name">{beat.name}</div>
              <div className="beat-summary-preview">{beat.summary}</div>
            </div>
            <span className={`beat-status-badge ${beat.status}`}>{beat.status}</span>
          </div>
          {beat.status === "written" && beat.sceneContent && (
            <div style={{ padding: "0 16px 16px" }}>
              <div className="scene-content">{beat.sceneContent}</div>
            </div>
          )}
          {beat.status === "design" && (
            <div style={{ padding: "0 16px 16px" }}>
              <button className="btn-primary" disabled={busy}
                style={{ width: "100%", fontSize: 13, padding: "12px 16px", minHeight: 0 }}
                onClick={() => run(
                  { type: "generate_scene", payload: { beatIndex: i } },
                  `Write · ${beat.name}`
                )}>
                Write this scene
              </button>
            </div>
          )}
        </div>
      ))}

      {beats.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          <button className="btn-secondary" disabled={busy} style={{ flex: 1, fontSize: 13 }}
            onClick={() => run({ type: "add_twist", payload: {} }, "Add twist")}>⚡ Add twist</button>
          <button className="btn-secondary" disabled={busy} style={{ flex: 1, fontSize: 13 }}
            onClick={() => run(
              { type: "brainstorm", payload: { prompt: "ways to deepen the conflict" } },
              "Brainstorm"
            )}>✎ Brainstorm</button>
        </div>
      )}
    </>
  );
}

/* ============================================ */
/* ============ BEAT CREATION FORM ============ */
/* ============================================ */

interface BeatAISettings {
  weirdness: number;
  darkness: number;
  humor: number;
  length: number;
}

const DEFAULT_BEAT_AI: BeatAISettings = { weirdness: 5, darkness: 5, humor: 3, length: 5 };
const BEAT_AI_KEY = "scriptlab.beatAISettings";

function loadBeatAISettings(): BeatAISettings {
  if (typeof window === "undefined") return DEFAULT_BEAT_AI;
  try { return { ...DEFAULT_BEAT_AI, ...JSON.parse(localStorage.getItem(BEAT_AI_KEY) || "{}") }; }
  catch { return DEFAULT_BEAT_AI; }
}
function saveBeatAISettings(s: BeatAISettings) {
  if (typeof window !== "undefined") localStorage.setItem(BEAT_AI_KEY, JSON.stringify(s));
}

function BeatCreationForm({
  story, onSave, busy,
}: {
  story: Story;
  onSave: (name: string, summary: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [recording, setRecording] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiSettings, setAISettings] = useState<BeatAISettings>(loadBeatAISettings);
  const recognitionRef = useRef<any>(null);
  const capturedRef = useRef("");

  function toggleRecord() {
    const SR: any =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SR) return;
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    capturedRef.current = "";
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
      setSummary((capturedRef.current + interim).trim());
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  }

  async function callAI(actionType: string, payload: Record<string, any>,
    onResult: (parsed: any) => void) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story, action: { type: actionType, payload } }),
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
      if (match) onResult(JSON.parse(match[0]));
    } catch {}
  }

  async function cleanUp() {
    if (!summary.trim() || busy) return;
    setCleaning(true);
    try {
      await callAI("clean_beat", { rawText: summary }, (parsed) => {
        if (parsed.name) setName(parsed.name);
        if (parsed.summary) setSummary(parsed.summary);
      });
    } finally { setCleaning(false); }
  }

  async function createWithAI() {
    setGenerating(true);
    saveBeatAISettings(aiSettings);
    setShowAISettings(false);
    try {
      await callAI("generate_beat", {
        position: story.beats.length,
        weirdness: aiSettings.weirdness,
        darkness: aiSettings.darkness,
        humor: aiSettings.humor,
        length: aiSettings.length,
      }, (parsed) => {
        if (parsed.name) setName(parsed.name);
        if (parsed.summary) setSummary(parsed.summary);
      });
    } finally { setGenerating(false); }
  }

  return (
    <div className="stack">
      <input className="field" placeholder="Beat name" value={name}
        onChange={e => setName(e.target.value)} />

      {/* Record button */}
      <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
        <button
          className={`record-fab ${recording ? "recording" : ""}`}
          onClick={toggleRecord}
          style={{ position: "static", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}
        >
          <div className="red-dot" />
        </button>
      </div>
      <div className="caption" style={{ textAlign: "center" }}>
        {recording ? "Listening… tap to stop" : "Tap to describe this beat by voice"}
      </div>

      <textarea className="field" placeholder="Or type the beat description here"
        value={summary} onChange={e => setSummary(e.target.value)} rows={4} />

      {/* Actions row */}
      <div style={{ display: "flex", gap: 8 }}>
        {summary.trim() && (
          <>
            <button className="btn-secondary" onClick={cleanUp}
              disabled={cleaning || busy || generating}
              style={{ fontSize: 13, flex: 1 }}>
              {cleaning ? "Cleaning…" : "✨ Clean up"}
            </button>
            <button className="btn-secondary"
              onClick={() => { setName(""); setSummary(""); }}
              style={{ fontSize: 13 }}>
              ↺ Redo
            </button>
          </>
        )}
        {!summary.trim() && (
          <button className="btn-secondary"
            onClick={() => setShowAISettings(true)}
            disabled={busy || generating}
            style={{ fontSize: 13, flex: 1 }}>
            {generating ? "Creating…" : "✦ Create with AI"}
          </button>
        )}
      </div>

      {/* AI settings popup */}
      {showAISettings && (
        <div className="card" style={{ marginTop: 4, border: "1px solid var(--border-strong)" }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>AI beat settings</div>
          {[
            { key: "weirdness" as const, label: "Weirdness" },
            { key: "darkness" as const,  label: "Darkness" },
            { key: "humor" as const,     label: "Humor" },
            { key: "length" as const,    label: "Length" },
          ].map(({ key, label }) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <div className="slider-row">
                <div className="label">{label}</div>
                <div className="value">{aiSettings[key]}</div>
              </div>
              <input type="range" min={1} max={10} value={aiSettings[key]}
                onChange={e => setAISettings(s => ({ ...s, [key]: Number(e.target.value) }))} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={createWithAI}
              disabled={generating} style={{ flex: 1, fontSize: 13, padding: "12px 16px", minHeight: 0 }}>
              {generating ? "Creating…" : "Create"}
            </button>
            <button className="btn-secondary" onClick={() => setShowAISettings(false)}
              style={{ fontSize: 13, padding: "12px 16px", minHeight: 0 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <button className="btn-primary" onClick={() => onSave(name || "Untitled beat", summary)}
        disabled={!summary.trim()} style={{ fontSize: 14 }}>
        Save beat
      </button>
    </div>
  );
}

/* ============================================ */
/* ============ CONFIGURE TAB ================= */
/* ============================================ */

function ConfigureTab({
  story, setStory,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
}) {
  const s = story.settings;
  const set = <K extends keyof Story["settings"]>(k: K, v: Story["settings"][K]) =>
    setStory(st => ({ ...st, settings: { ...st.settings, [k]: v } }));

  return (
    <>
      <div className="display" style={{ marginBottom: 18 }}>Setup</div>

      <div className="card">
        <span className="eyebrow">Project</span>
        <div className="stack">
          <input className="field" value={story.title}
            onChange={e => setStory(st => ({ ...st, title: e.target.value }))}
            placeholder="Title" />
          <textarea className="field" value={story.logline}
            onChange={e => setStory(st => ({ ...st, logline: e.target.value }))}
            placeholder="Logline" rows={3} />
        </div>
      </div>

      <div className="card">
        <span className="eyebrow">Shape</span>
        <div className="stack">
          <div className="select-wrap">
            <select className="field" value={s.framework}
              onChange={e => set("framework", e.target.value as any)}>
              <option value="save-the-cat">Save the Cat</option>
              <option value="heros-journey">Hero's Journey</option>
              <option value="three-act">Three Act</option>
              <option value="story-circle">Story Circle</option>
            </select>
          </div>
          <div className="eyebrow" style={{ marginTop: 8 }}>Genres</div>
          <div className="chip-row">
            {(["thriller","drama","comedy","horror","sci-fi","romance","action","mystery"] as const).map(g => (
              <button key={g}
                className={`chip ${s.genres.includes(g) ? "selected" : ""}`}
                onClick={() => set("genres",
                  s.genres.includes(g) ? s.genres.filter(x => x !== g) : [...s.genres, g]
                )}>
                {g}
              </button>
            ))}
          </div>
          <input className="field" value={s.vibe}
            onChange={e => set("vibe", e.target.value)} placeholder="Vibe" />
        </div>
      </div>

      <div className="card">
        <span className="eyebrow">Dials</span>
        <div className="stack" style={{ marginTop: 8 }}>
          <Slider label="Unpredictability" value={s.unpredictability} onChange={v => set("unpredictability", v)} />
          <Slider label="Darkness"         value={s.darkness}         onChange={v => set("darkness", v)} />
          <Slider label="Pace"             value={s.pace}             onChange={v => set("pace", v)} />
        </div>
      </div>

      <div className="card">
        <span className="eyebrow">Characters</span>
        {story.characters.length === 0 && (
          <div className="caption" style={{ marginTop: 4 }}>No characters yet.</div>
        )}
        {story.characters.map(ch => (
          <div key={ch.id} className="inset-card">
            <div style={{ fontSize: 15, fontWeight: 900 }}>{ch.name}</div>
            <div className="caption" style={{ marginTop: 4 }}>
              {ch.role} · wants: {ch.want || "—"} · needs: {ch.need || "—"}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <span className="eyebrow">Ingredients</span>
        {story.ingredients.length === 0 && (
          <div className="caption" style={{ marginTop: 4 }}>No ingredients yet.</div>
        )}
        {story.ingredients.map(ing => (
          <div key={ing.id} className="inset-card">
            <div className="eyebrow">{ing.label} {ing.locked && "· locked"}</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{ing.description}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ============================================ */
/* ============ MOMENT PICKER ================= */
/* ============================================ */

function MomentPicker({
  moments, linkedIds, onLink,
}: {
  moments: Moment[];
  linkedIds: string[];
  onLink: (momentId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const filters = ["All", "Scene", "Dialogue", "Joke", "Memory", "Character", "Image"];
  const filtered = moments.filter(m => {
    if (filter !== "All" && m.type !== filter.toLowerCase()) return false;
    if (search && !m.text.toLowerCase().includes(search.toLowerCase()) &&
        !m.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  return (
    <>
      <div className="search-bar" style={{ marginBottom: 10 }}>
        <svg viewBox="0 0 24 24" style={{width:18,height:18,stroke:"var(--ink-mute)",strokeWidth:1.8,fill:"none"}}>
          <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>
        </svg>
        <input placeholder="Search moments" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="filter-row" style={{ marginBottom: 12 }}>
        {filters.map(f => (
          <button key={f} className={`filter-pill ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)} style={{ fontSize: 12, padding: "6px 12px" }}>{f}</button>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="caption" style={{ textAlign: "center", padding: "20px 0" }}>No moments match.</div>
      )}
      {filtered.map(m => {
        const isLinked = linkedIds.includes(m.id);
        return (
          <button key={m.id}
            className={`moment-picker-item ${isLinked ? "linked" : ""}`}
            onClick={() => !isLinked && onLink(m.id)}
            style={{ width: "100%", textAlign: "left" }}>
            <div style={{ flex: 1 }}>
              <div className="mp-type">{m.type}</div>
              <div className="mp-text">{m.text}</div>
              {m.tags.length > 0 && (
                <div className="mp-tags">{m.tags.map(t => <span key={t}>{t}</span>)}</div>
              )}
            </div>
            {isLinked && <div className="mp-linked-badge">Linked</div>}
          </button>
        );
      })}
    </>
  );
}

/* ============================================ */
/* ============ SHARED ======================== */
/* ============================================ */

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="slider-row">
        <div className="label">{label}</div>
        <div className="value">{value}</div>
      </div>
      <input type="range" min={1} max={10} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}
