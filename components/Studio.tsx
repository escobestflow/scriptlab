"use client";

import { useState } from "react";
import { Story, Beat } from "@/lib/story";
import { Moment } from "@/lib/sampleData";
import { ActionRequest } from "@/lib/prompt";

type Tab = "design" | "execute" | "setup";

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
  const [tab, setTab] = useState<Tab>("design");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTitle, setSheetTitle] = useState("");
  // Moment picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBeatId, setPickerBeatId] = useState<string | null>(null);

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

      // If this was a scene generation, save the content to the beat
      if (action.type === "generate_scene" && action.payload.beatIndex != null) {
        const idx = action.payload.beatIndex;
        setStory(s => ({
          ...s,
          beats: s.beats.map((b, i) =>
            i === idx ? { ...b, status: "written" as const, sceneContent: fullText } : b
          ),
        }));
      }
    } finally {
      setBusy(false);
    }
  }

  // Beat management
  function addBeat(name: string, summary: string) {
    const newBeat: Beat = {
      id: "b_" + Math.random().toString(36).slice(2),
      name,
      summary,
      purpose: "",
      position: story.beats.length,
      momentIds: [],
      status: "design",
    };
    setStory(s => ({ ...s, beats: [...s.beats, newBeat] }));
  }

  function moveBeat(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    setStory(s => {
      const beats = [...s.beats];
      [beats[index], beats[target]] = [beats[target], beats[index]];
      return { ...s, beats: beats.map((b, i) => ({ ...b, position: i })) };
    });
  }

  function removeBeat(id: string) {
    setStory(s => ({
      ...s,
      beats: s.beats.filter(b => b.id !== id).map((b, i) => ({ ...b, position: i })),
    }));
  }

  function linkMoment(beatId: string, momentId: string) {
    setStory(s => ({
      ...s,
      beats: s.beats.map(b =>
        b.id === beatId && !b.momentIds.includes(momentId)
          ? { ...b, momentIds: [...b.momentIds, momentId] }
          : b
      ),
    }));
    setPickerOpen(false);
    setPickerBeatId(null);
  }

  function unlinkMoment(beatId: string, momentId: string) {
    setStory(s => ({
      ...s,
      beats: s.beats.map(b =>
        b.id === beatId
          ? { ...b, momentIds: b.momentIds.filter(id => id !== momentId) }
          : b
      ),
    }));
  }

  function openMomentPicker(beatId: string) {
    setPickerBeatId(beatId);
    setPickerOpen(true);
  }

  return (
    <>
      {/* Top bar */}
      <div className="topbar">
        <button className="topbar-btn" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" style={{width:22,height:22,stroke:"currentColor",strokeWidth:1.8,fill:"none"}}><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div className="eyebrow">{story.settings.framework.replace(/-/g, " ")}</div>
          <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-0.01em", marginTop: 2 }}>
            {story.title || "Untitled"}
          </div>
        </div>
        <div style={{ width: 44 }} />
      </div>

      {/* Content */}
      <div className="screen-scroll" key={tab}>
        <div className="page-enter">
          {tab === "design" && (
            <DesignTab
              story={story}
              moments={moments}
              addBeat={addBeat}
              moveBeat={moveBeat}
              removeBeat={removeBeat}
              unlinkMoment={unlinkMoment}
              openMomentPicker={openMomentPicker}
              run={run}
              busy={busy}
            />
          )}
          {tab === "execute" && (
            <ExecuteTab story={story} run={run} busy={busy} />
          )}
          {tab === "setup" && (
            <ConfigureTab story={story} setStory={setStory} />
          )}
        </div>
      </div>

      {/* Tab bar */}
      <nav className="tabbar">
        <div className="tabbar-inner">
          {[
            { id: "design",  icon: "◆", label: "Design" },
            { id: "execute", icon: "▶", label: "Execute" },
            { id: "setup",   icon: "⚙", label: "Setup" },
          ].map(t => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id as Tab)}
            >
              <span className="icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Streaming output sheet */}
      <div
        className={`sheet-backdrop ${sheetOpen ? "open" : ""}`}
        onClick={() => setSheetOpen(false)}
      />
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
      <div
        className={`sheet-backdrop ${pickerOpen ? "open" : ""}`}
        onClick={() => { setPickerOpen(false); setPickerBeatId(null); }}
      />
      <div className={`sheet ${pickerOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">Link a moment</div>
          <button className="chip" onClick={() => { setPickerOpen(false); setPickerBeatId(null); }}>Close</button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <MomentPicker
            moments={moments}
            linkedIds={pickerBeatId ? (story.beats.find(b => b.id === pickerBeatId)?.momentIds ?? []) : []}
            onLink={(momentId) => pickerBeatId && linkMoment(pickerBeatId, momentId)}
          />
        </div>
      </div>
    </>
  );
}

/* ============================================ */
/* ============ DESIGN TAB ==================== */
/* ============================================ */

function DesignTab({
  story, moments, addBeat, moveBeat, removeBeat, unlinkMoment, openMomentPicker, run, busy,
}: {
  story: Story;
  moments: Moment[];
  addBeat: (name: string, summary: string) => void;
  moveBeat: (index: number, direction: "up" | "down") => void;
  removeBeat: (id: string) => void;
  unlinkMoment: (beatId: string, momentId: string) => void;
  openMomentPicker: (beatId: string) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingBeat, setAddingBeat] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSummary, setNewSummary] = useState("");

  function handleAddBeat() {
    if (!newName.trim()) return;
    addBeat(newName.trim(), newSummary.trim());
    setNewName("");
    setNewSummary("");
    setAddingBeat(false);
  }

  const sorted = [...story.beats].sort((a, b) => a.position - b.position);

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <div className="display">Design</div>
      </div>
      <div className="caption" style={{ marginBottom: 18 }}>
        Structure your story before writing. Add beats, reorder them, link your Moments.
      </div>

      {sorted.length === 0 && !addingBeat && (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>◆</div>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>No beats yet</div>
          <div className="caption" style={{ marginBottom: 16 }}>
            Add beats manually, or let AI generate a starting structure.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn-primary" style={{ fontSize: 14, padding: "14px 22px", minHeight: 0 }}
              onClick={() => setAddingBeat(true)}>
              + Add beat
            </button>
            <button className="btn-secondary" disabled={busy}
              onClick={() => run({ type: "generate_beats", payload: {} }, "Generate beat sheet")}
              style={{ fontSize: 14, padding: "14px 22px", minHeight: 0 }}>
              AI generate
            </button>
          </div>
        </div>
      )}

      {sorted.map((beat, i) => {
        const isExpanded = expanded === beat.id;
        const linkedMoments = beat.momentIds
          .map(id => moments.find(m => m.id === id))
          .filter(Boolean) as Moment[];

        return (
          <div key={beat.id} className={`beat-card ${isExpanded ? "expanded" : ""}`}>
            <button
              className="beat-header"
              onClick={() => setExpanded(isExpanded ? null : beat.id)}
            >
              <div className={`beat-number ${beat.status === "written" ? "written" : ""}`}>
                {i + 1}
              </div>
              <div className="beat-info">
                <div className="beat-name">{beat.name}</div>
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

            {isExpanded && (
              <div className="beat-body">
                {/* Summary */}
                <div className="beat-section-label">Summary</div>
                <div className="beat-text">{beat.summary || <span className="beat-text muted">No summary yet</span>}</div>

                {/* Purpose */}
                {beat.purpose && (
                  <>
                    <div className="beat-section-label">Purpose</div>
                    <div className="beat-text">{beat.purpose}</div>
                  </>
                )}

                {/* Linked moments */}
                <div className="beat-section-label">
                  Linked moments · {linkedMoments.length}
                </div>
                {linkedMoments.length > 0 ? (
                  <div className="beat-moments">
                    {linkedMoments.map(m => (
                      <div key={m.id} className="linked-moment">
                        <div className="moment-type-dot" />
                        <div className="moment-preview">{m.text}</div>
                        <button
                          className="btn-icon"
                          style={{ width: 28, height: 28, fontSize: 14 }}
                          onClick={() => unlinkMoment(beat.id, m.id)}
                          aria-label="Unlink moment"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="caption">No moments linked yet.</div>
                )}

                {/* Actions */}
                <div className="beat-actions">
                  <button className="btn-secondary" style={{ fontSize: 12, padding: "8px 14px", minHeight: 0 }}
                    onClick={() => openMomentPicker(beat.id)}>
                    + Link moment
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 12, padding: "8px 14px", minHeight: 0, color: "var(--ink-mute)" }}
                    onClick={() => removeBeat(beat.id)}>
                    Remove
                  </button>
                </div>

                {/* Reorder */}
                <div className="beat-reorder">
                  <button className="reorder-btn" disabled={i === 0}
                    onClick={() => moveBeat(i, "up")} aria-label="Move up">
                    ↑
                  </button>
                  <button className="reorder-btn" disabled={i === sorted.length - 1}
                    onClick={() => moveBeat(i, "down")} aria-label="Move down">
                    ↓
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add beat area */}
      {sorted.length > 0 && !addingBeat && (
        <div className="add-beat-area" style={{ display: "flex", gap: 10 }}>
          <button className="btn-secondary" style={{ flex: 1, fontSize: 13 }}
            onClick={() => setAddingBeat(true)}>
            + Add beat
          </button>
          <button className="btn-secondary" disabled={busy} style={{ fontSize: 13 }}
            onClick={() => run({ type: "generate_beats", payload: {} }, "AI generate beats")}>
            AI generate
          </button>
        </div>
      )}

      {addingBeat && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>New beat</div>
          <div className="stack">
            <input className="field" placeholder="Beat name" value={newName}
              onChange={e => setNewName(e.target.value)} autoFocus />
            <textarea className="field" placeholder="What happens in this beat?" value={newSummary}
              onChange={e => setNewSummary(e.target.value)} rows={3} />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1, fontSize: 13, padding: "12px 16px", minHeight: 0 }}
                onClick={handleAddBeat} disabled={!newName.trim()}>
                Add
              </button>
              <button className="btn-secondary" style={{ fontSize: 13, padding: "12px 16px", minHeight: 0 }}
                onClick={() => { setAddingBeat(false); setNewName(""); setNewSummary(""); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ============================================ */
/* ============ EXECUTE TAB =================== */
/* ============================================ */

function ExecuteTab({
  story, run, busy,
}: {
  story: Story;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
}) {
  const sorted = [...story.beats].sort((a, b) => a.position - b.position);
  const designCount = sorted.filter(b => b.status === "design").length;
  const writtenCount = sorted.filter(b => b.status === "written").length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <div className="display">Execute</div>
      </div>
      <div className="caption" style={{ marginBottom: 18 }}>
        Write scenes from your design. {writtenCount}/{sorted.length} beats written.
      </div>

      {sorted.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
          <div className="caption">
            No beats to execute yet. Go to <b>Design</b> to structure your story first.
          </div>
        </div>
      )}

      {sorted.map((beat, i) => (
        <div key={beat.id} className="beat-card">
          <div className="beat-header" style={{ cursor: "default" }}>
            <div className={`beat-number ${beat.status === "written" ? "written" : ""}`}>
              {i + 1}
            </div>
            <div className="beat-info">
              <div className="beat-name">{beat.name}</div>
              <div className="beat-summary-preview">{beat.summary}</div>
            </div>
            <span className={`beat-status-badge ${beat.status}`}>
              {beat.status}
            </span>
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

      {sorted.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          <button className="btn-secondary" disabled={busy} style={{ flex: 1, fontSize: 13 }}
            onClick={() => run({ type: "add_twist", payload: {} }, "Add twist")}>
            ⚡ Add twist
          </button>
          <button className="btn-secondary" disabled={busy} style={{ flex: 1, fontSize: 13 }}
            onClick={() => run(
              { type: "brainstorm", payload: { prompt: "ways to deepen the conflict" } },
              "Brainstorm"
            )}>
            ✎ Brainstorm
          </button>
        </div>
      )}
    </>
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
          <div className="select-wrap">
            <select className="field" value={s.genre}
              onChange={e => set("genre", e.target.value as any)}>
              {["thriller","drama","comedy","horror","sci-fi","romance","action","mystery"].map(g =>
                <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <input className="field" value={s.vibe}
            onChange={e => set("vibe", e.target.value)} placeholder="Vibe" />
          <div className="select-wrap">
            <select className="field" value={s.endingType}
              onChange={e => set("endingType", e.target.value as any)}>
              {["happy","bittersweet","tragic","ambiguous","twist"].map(g =>
                <option key={g} value={g}>ending: {g}</option>)}
            </select>
          </div>
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
            {ch.notes && <div className="caption" style={{ marginTop: 2 }}>{ch.notes}</div>}
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
        <input placeholder="Search moments" value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="filter-row" style={{ marginBottom: 12 }}>
        {filters.map(f => (
          <button key={f}
            className={`filter-pill ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
            style={{ fontSize: 12, padding: "6px 12px" }}>
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="caption" style={{ textAlign: "center", padding: "20px 0" }}>
          No moments match your search.
        </div>
      )}

      {filtered.map(m => {
        const isLinked = linkedIds.includes(m.id);
        return (
          <button
            key={m.id}
            className={`moment-picker-item ${isLinked ? "linked" : ""}`}
            onClick={() => !isLinked && onLink(m.id)}
            style={{ width: "100%", textAlign: "left" }}
          >
            <div style={{ flex: 1 }}>
              <div className="mp-type">{m.type}</div>
              <div className="mp-text">{m.text}</div>
              {m.tags.length > 0 && (
                <div className="mp-tags">
                  {m.tags.map(t => <span key={t}>{t}</span>)}
                </div>
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

function Slider({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="slider-row">
        <div className="label">{label}</div>
        <div className="value">{value}</div>
      </div>
      <input type="range" min={1} max={10} value={value}
        onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}
