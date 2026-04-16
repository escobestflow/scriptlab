"use client";

import { useRef, useState, useCallback } from "react";
import {
  Story, Beat, Episode, Character, CharacterRelationship, Scene, StorySettings,
  ConceptLayerDraft, CharactersLayerDraft, StoryLayerDraft, ScriptLayerDraft, ProjectDraft,
  LayerKey, LayerSyncState,
  getActiveProjectDraft,
  getActiveConceptDraft, getActiveCharactersDraft, getActiveStoryLayerDraft, getActiveScriptDraft,
  updateConceptDraft, updateCharactersDraft, updateStoryLayerDraft, updateScriptDraft,
  createNewLayerDraft, switchLayerDraft, deleteLayerDraft,
  createNewProjectDraft, switchProjectDraft, deleteProjectDraft,
  getLayerSyncState, markLayerSynced,
} from "@/lib/story";
import { createProjectFromDraft } from "@/lib/storage";
import { Moment } from "@/lib/sampleData";
import { ActionRequest } from "@/lib/prompt";

type Section = "concept" | "characters" | "story" | "script";

export function Studio({
  story,
  setStory,
  moments,
  onBack,
  isNew = false,
  onCreateProjectFromDraft,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  moments: Moment[];
  onBack: () => void;
  isNew?: boolean;
  onCreateProjectFromDraft?: (newStory: Story) => void;
}) {
  const [section, setSection] = useState<Section>("concept");
  const [showSuccess, setShowSuccess] = useState(isNew);
  const [draftsDropdownOpen, setDraftsDropdownOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !thumbRef.current) return;
    const y = scrollRef.current.scrollTop;
    thumbRef.current.style.opacity = `${Math.max(0, 1 - y / 60)}`;
  }, []);
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

  // Active layer drafts — where all editing happens
  const activeProjectDraft = getActiveProjectDraft(story);
  const activeConcept      = getActiveConceptDraft(story);
  const activeCharacters   = getActiveCharactersDraft(story);
  const activeStoryLayer   = getActiveStoryLayerDraft(story);
  const activeScriptDraft  = getActiveScriptDraft(story);
  const syncState          = getLayerSyncState(story);

  // Determine which beats we're editing
  const isTV = story.projectType === "tv-show";
  const activeEpisode = isTV ? activeStoryLayer.episodes?.find(ep => ep.id === activeEpisodeId) : null;
  const beats = isTV
    ? (activeEpisode?.beats ?? [])
    : activeStoryLayer.beats;
  const setBeats = (updater: (bs: Beat[]) => Beat[]) => {
    if (isTV && activeEpisodeId) {
      setStory(s => updateStoryLayerDraft(s, {
        episodes: getActiveStoryLayerDraft(s).episodes?.map(ep =>
          ep.id === activeEpisodeId ? { ...ep, beats: updater(ep.beats) } : ep
        ),
      }));
    } else {
      setStory(s => updateStoryLayerDraft(s, { beats: updater(getActiveStoryLayerDraft(s).beats) }));
    }
  };

  // ── Draft management actions (project-level) ──
  const handleCreateNewProjectDraft = () => {
    setStory(s => createNewProjectDraft(s));
    setDraftsDropdownOpen(false);
  };
  const handleLoadProjectDraft = (draftId: string) => {
    setStory(s => switchProjectDraft(s, draftId));
    setDraftsDropdownOpen(false);
  };
  const handleDeleteProjectDraft = (draftId: string) => {
    setStory(s => deleteProjectDraft(s, draftId));
  };
  const handleCreateProjectFromDraft = (draftId: string) => {
    const newStory = createProjectFromDraft(story, draftId);
    onCreateProjectFromDraft?.(newStory);
  };

  // ── Layer draft actions ──
  const handleCreateNewLayerDraft = (layer: LayerKey) => {
    setStory(s => createNewLayerDraft(s, layer));
  };
  const handleSwitchLayerDraft = (layer: LayerKey, draftId: string) => {
    setStory(s => switchLayerDraft(s, layer, draftId));
  };
  const handleDeleteLayerDraft = (layer: LayerKey, draftId: string) => {
    setStory(s => deleteLayerDraft(s, layer, draftId));
  };
  const handleMarkLayerSynced = (layer: "characters" | "story" | "script") => {
    setStory(s => markLayerSynced(s, layer));
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

  // TV Show episode view (for Story tab only)
  if (isTV && !activeEpisodeId && section === "story" && !showSetup) {
    return (
      <>
        <ProjectHeader
          story={story}
          onBack={onBack}
          onSetup={() => setShowSetup(true)}
          subtitle={`${activeStoryLayer.episodes?.length ?? 0} episodes`}
        />
        <SectionTabs section={section} setSection={setSection} syncState={syncState} />
        <div className="screen-scroll">
          <div className="page-enter">
            {(activeStoryLayer.episodes ?? []).map(ep => (
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
                setStory(s => {
                  const ad = getActiveStoryLayerDraft(s);
                  return updateStoryLayerDraft(s, {
                    episodes: [
                      ...(ad.episodes ?? []),
                      {
                        id: "ep_" + Math.random().toString(36).slice(2),
                        title: `Episode ${(ad.episodes?.length ?? 0) + 1}`,
                        number: (ad.episodes?.length ?? 0) + 1,
                        beats: [],
                      },
                    ],
                  });
                });
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
          subtitle="Settings"
        />
        <div className="screen-scroll">
          <div className="page-enter">
            <SettingsTab
              story={story}
              setStory={setStory}
              onLoadProjectDraft={handleLoadProjectDraft}
              onDeleteProjectDraft={handleDeleteProjectDraft}
              onCreateProjectFromDraft={handleCreateProjectFromDraft}
              onSwitchLayerDraft={handleSwitchLayerDraft}
              onDeleteLayerDraft={handleDeleteLayerDraft}
            />
          </div>
        </div>
      </>
    );
  }

  const sorted = [...beats].sort((a, b) => a.position - b.position);

  // Scroll values are driven directly via refs in handleScroll — no state re-renders

  return (
    <>
      {/* Nav row — fixed above scroll, never moves */}
      <div className="studio-nav-fixed">
        <button className="project-header-btn" onClick={handleBack} aria-label="Back">
          <svg viewBox="0 0 24 24" style={{width:20,height:20,stroke:"currentColor",strokeWidth:1.8,fill:"none"}}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          <span>BACK</span>
        </button>
        <div style={{ flex: 1 }} />
        <button className="project-header-btn" onClick={() => setShowSetup(true)} aria-label="Settings">
          <img src="/settings-icon.svg" alt="" style={{ width: 17, height: 14 }} />
        </button>
      </div>

      {/* Scroll container — extends behind nav */}
      <div
        className="studio-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {/* Thumbnail — scrolls with content, not sticky */}
        <div className="studio-thumb-scroll" ref={thumbRef}>
          {story.thumbnail ? (
            <img src={story.thumbnail} alt="" className="project-header-thumb" />
          ) : (
            <div className="project-header-thumb project-header-thumb-placeholder">
              {story.title ? story.title.charAt(0).toUpperCase() : "?"}
            </div>
          )}
        </div>

        {/* Title + drafts dropdown + tabs — sticky, sticks below nav */}
        <div className="studio-header-sticky">
          <div className="project-header-title">
            {story.title || "Untitled"}
          </div>

          {/* Project drafts dropdown trigger */}
          <button
            className="drafts-dropdown-trigger"
            onClick={() => setDraftsDropdownOpen(v => !v)}
          >
            <span>Draft {activeProjectDraft.number}</span>
            <img src="/caret-sm.svg" alt="" className={`drafts-caret ${draftsDropdownOpen ? "open" : ""}`} />
          </button>

          {isTV && activeEpisode && (
            <div className="caption" style={{ textAlign: "center" }}>{activeEpisode.title}</div>
          )}

          {/* Project-level Save button — shown when any layer is dirty */}
          {(() => {
            const anyDirty =
              new Date(activeConcept.updatedAt).getTime()    > new Date(activeConcept.createdAt).getTime() ||
              new Date(activeCharacters.updatedAt).getTime() > new Date(activeCharacters.createdAt).getTime() ||
              new Date(activeStoryLayer.updatedAt).getTime() > new Date(activeStoryLayer.createdAt).getTime() ||
              new Date(activeScriptDraft.updatedAt).getTime() > new Date(activeScriptDraft.createdAt).getTime();
            if (!anyDirty) return null;
            return (
              <button className="project-save-btn" onClick={handleCreateNewProjectDraft}>
                Save draft
              </button>
            );
          })()}

          <div className="studio-tabs-row">
            <SectionTabs section={section} setSection={setSection} syncState={syncState} />
          </div>

          {/* Project drafts dropdown menu */}
          {draftsDropdownOpen && (
            <>
              <div className="drafts-dropdown-backdrop" onClick={() => setDraftsDropdownOpen(false)} />
              <div className="drafts-dropdown-menu">
                <button className="drafts-dropdown-create" onClick={handleCreateNewProjectDraft}>
                  <span className="drafts-dropdown-create-icon">+</span>
                  <span>Create new project draft</span>
                </button>
                {[...story.projectDrafts]
                  .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                  .map(draft => {
                    const isActive = draft.id === story.activeProjectDraftId;
                    const date = new Date(draft.updatedAt);
                    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    // Badge showing which layer drafts this project draft references
                    const cNum  = story.conceptDrafts.find(x => x.id === draft.conceptDraftId)?.number ?? "?";
                    const chNum = story.charactersDrafts.find(x => x.id === draft.charactersDraftId)?.number ?? "?";
                    const sNum  = story.storyDrafts.find(x => x.id === draft.storyDraftId)?.number ?? "?";
                    const scNum = story.scriptDrafts.find(x => x.id === draft.scriptDraftId)?.number ?? "?";
                    return (
                      <button
                        key={draft.id}
                        className={`drafts-dropdown-item ${isActive ? "active" : ""}`}
                        onClick={() => handleLoadProjectDraft(draft.id)}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
                          <span>Draft {draft.number}</span>
                          <span style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 400 }}>
                            C{cNum} · Ch{chNum} · S{sNum} · Sc{scNum}
                          </span>
                        </div>
                        <span className="drafts-dropdown-date">{dateStr}</span>
                      </button>
                    );
                  })}
              </div>
            </>
          )}
        </div>

        {/* Tab content */}
        <div style={{ padding: "8px 22px 40px" }}>
          {section === "concept" && (
            <ConceptTab
              story={story}
              setStory={setStory}
              showSuccess={showSuccess}
              onDismissSuccess={() => setShowSuccess(false)}
            />
          )}
          {section === "characters" && (
            <CharactersTab
              story={story}
              setStory={setStory}
              run={run}
              busy={busy}
            />
          )}
          {section === "story" && (
            <StoryTab
              story={story}
              setStory={setStory}
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
              syncState={syncState}
            />
          )}
          {section === "script" && (
            <ScriptTab
              story={story}
              setStory={setStory}
              beats={sorted}
              run={run}
              busy={busy}
            />
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
          {output || (busy ? "Thinking..." : "Nothing here yet.")}
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
      <div className={`sheet sheet-tall ${beatTrayOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">New beat</div>
          <button className="chip" onClick={() => setBeatTrayOpen(false)}>Cancel</button>
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
/* ============ SECTION TABS ================== */
/* ============================================ */

function SectionTabs({
  section,
  setSection,
  syncState,
}: {
  section: Section;
  setSection: (s: Section) => void;
  syncState: LayerSyncState;
}) {
  const tabs: { key: Section; label: string; dot?: boolean }[] = [
    { key: "concept", label: "CONCEPT" },
    { key: "characters", label: "CHARACTERS" },
    { key: "story", label: "STORY", dot: syncState.storyOutOfSync },
    { key: "script", label: "SCRIPT", dot: syncState.scriptOutOfSync },
  ];

  return (
    <div className="studio-tab-bar">
      {tabs.map(t => (
        <button
          key={t.key}
          className={`studio-tab ${section === t.key ? "active" : ""}`}
          onClick={() => setSection(t.key)}
        >
          <span className="studio-tab-label">{t.label}</span>
          {t.dot && <span className="sync-dot" />}
        </button>
      ))}
    </div>
  );
}

/* ============================================ */
/* ============ PROJECT HEADER ================ */
/* ============================================ */

/* Simple topbar header for sub-views (settings, episodes) */
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
        <button className="topbar-btn" onClick={onSetup} aria-label="Settings">
          <img src="/settings-icon.svg" alt="" style={{ width: 17, height: 14 }} />
        </button>
      ) : (
        <div style={{ width: 44 }} />
      )}
    </div>
  );
}

/* ============================================ */
/* ============ CONCEPT TAB =================== */
/* ============================================ */

/* ── Collapsible attribute row ── */
/* ── Layer draft picker ── */
function LayerDraftPicker({
  layer, label, story, setStory,
}: {
  layer: LayerKey;
  label: string;
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
}) {
  const [open, setOpen] = useState(false);
  const pool = (
    layer === "concept"    ? story.conceptDrafts :
    layer === "characters" ? story.charactersDrafts :
    layer === "story"      ? story.storyDrafts :
                             story.scriptDrafts
  );
  const pd = getActiveProjectDraft(story);
  const activeId = (
    layer === "concept"    ? pd.conceptDraftId :
    layer === "characters" ? pd.charactersDraftId :
    layer === "story"      ? pd.storyDraftId :
                             pd.scriptDraftId
  );
  const active = pool.find((d: any) => d.id === activeId) ?? pool[0];

  const handleCreate = () => {
    setStory(s => createNewLayerDraft(s, layer));
    setOpen(false);
  };
  const handleSwitch = (id: string) => {
    setStory(s => switchLayerDraft(s, layer, id));
    setOpen(false);
  };

  const sorted = [...pool].sort((a: any, b: any) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // "Dirty" = edited since creation. Save button appears in this state.
  const isDirty = active && new Date(active.updatedAt).getTime() > new Date(active.createdAt).getTime();

  const handleSave = () => {
    setStory(s => createNewLayerDraft(s, layer));
  };

  return (
    <div className="layer-draft-picker">
      <button
        className="layer-draft-trigger"
        onClick={() => setOpen(v => !v)}
      >
        <span className="layer-draft-label">{label} Draft {active.number}</span>
        <img src="/caret-sm.svg" alt="" className={`drafts-caret ${open ? "open" : ""}`} />
      </button>
      {isDirty && (
        <button className="draft-save-btn" onClick={handleSave} aria-label="Save as new draft">
          Save
        </button>
      )}
      {open && (
        <>
          <div className="drafts-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="drafts-dropdown-menu layer-draft-menu">
            <button className="drafts-dropdown-create" onClick={handleCreate}>
              <span className="drafts-dropdown-create-icon">+</span>
              <span>Create new draft</span>
            </button>
            {sorted.map((d: any) => {
              const isActive = d.id === activeId;
              const date = new Date(d.updatedAt);
              const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <button
                  key={d.id}
                  className={`drafts-dropdown-item ${isActive ? "active" : ""}`}
                  onClick={() => handleSwitch(d.id)}
                >
                  <span>Draft {d.number}</span>
                  <span className="drafts-dropdown-date">{dateStr}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function AttrRow({
  label,
  values,
  placeholder,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  values?: string[];
  placeholder?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const hasValues = values && values.length > 0;
  return (
    <div className="attr-row">
      <button className="attr-row-header" onClick={onToggle}>
        <span className="attr-label">{label}</span>
        <div className="attr-values">
          {hasValues
            ? values.map(v => <span key={v} className="attr-pill">{v}</span>)
            : <span className="attr-placeholder">{placeholder || "Not set"}</span>
          }
        </div>
        <svg className={`attr-caret ${expanded ? "open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {expanded && (
        <div className="attr-row-body">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Text attribute row — stays open once filled, input loses chrome when unfocused ── */
function TextAttrRow({
  label,
  value,
  placeholder,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const hasValue = value.trim().length > 0;
  // Once text exists, always show the input (never collapse back)
  const isOpen = hasValue || focused;

  if (!isOpen) {
    // Collapsed: looks like a normal attr row, tappable to open
    return (
      <div className="attr-row">
        <button className="attr-row-header" onClick={() => setFocused(true)}>
          <span className="attr-label">{label}</span>
          <div className="attr-values">
            <span className="attr-placeholder">{placeholder}</span>
          </div>
          <svg className="attr-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    );
  }

  // Open: show input. When unfocused + has value: no border, white bg, no caret hint.
  const inputClass = `attr-text-input ${!focused && hasValue ? "unfocused-filled" : ""}`;

  return (
    <div className="attr-row attr-row-text-open">
      <div className="attr-row-header attr-row-header-static">
        <span className="attr-label">{label}</span>
      </div>
      <div className="attr-row-body">
        {multiline ? (
          <textarea
            className={inputClass}
            value={value}
            onChange={e => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={focused ? placeholder : ""}
            rows={3}
            autoFocus={!hasValue}
          />
        ) : (
          <input
            className={inputClass}
            value={value}
            onChange={e => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={focused ? placeholder : ""}
            autoFocus={!hasValue}
          />
        )}
      </div>
    </div>
  );
}

/* ── Success banner (shown after project creation) ── */
function SuccessBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="success-banner">
      <div className="success-icon">&#10003;</div>
      <div className="success-content">
        <div className="success-title">Project created!</div>
        <div className="success-text">
          Add more details below to help AI generate better story structure, characters, and scenes.
        </div>
      </div>
      <button className="success-dismiss" onClick={onDismiss} aria-label="Dismiss">
        <svg viewBox="0 0 24 24" style={{width:16,height:16,stroke:"currentColor",strokeWidth:2,fill:"none"}}>
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

function ConceptTab({
  story,
  setStory,
  showSuccess,
  onDismissSuccess,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  showSuccess: boolean;
  onDismissSuccess: () => void;
}) {
  const d = getActiveConceptDraft(story);
  const [openAttr, setOpenAttr] = useState<string | null>(null);
  const [themeInput, setThemeInput] = useState("");

  const toggle = (key: string) => setOpenAttr(prev => prev === key ? null : key);
  const updateDraft = (patch: Partial<ConceptLayerDraft>) => setStory(s => updateConceptDraft(s, patch));

  function addTheme() {
    const t = themeInput.trim();
    if (!t) return;
    updateDraft({ concept: { ...d.concept, themes: [...d.concept.themes, t] } });
    setThemeInput("");
  }

  function removeTheme(theme: string) {
    updateDraft({ concept: { ...d.concept, themes: d.concept.themes.filter(t => t !== theme) } });
  }

  const formatLabel = story.projectType === "tv-show" ? "TV Show" : story.projectType === "short" ? "Short Film" : "Feature Film";

  return (
    <>
      {showSuccess && <SuccessBanner onDismiss={onDismissSuccess} />}

      <LayerDraftPicker layer="concept" label="Concept" story={story} setStory={setStory} />

      {/* Format */}
      <AttrRow
        label="Format"
        values={[formatLabel.toUpperCase()]}
        expanded={openAttr === "format"}
        onToggle={() => toggle("format")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {([
            { value: "feature" as const, label: "Feature Film" },
            { value: "short" as const, label: "Short Film" },
            { value: "tv-show" as const, label: "TV Show" },
          ]).map(pt => (
            <button
              key={pt.value}
              className={`choice ${story.projectType === pt.value ? "selected" : ""}`}
              onClick={() => setStory(s => ({ ...s, projectType: pt.value }))}
              style={{ textAlign: "left", padding: "12px 14px" }}
            >
              <div className="choice-title">{pt.label}</div>
            </button>
          ))}
        </div>
      </AttrRow>

      {/* Genre */}
      <AttrRow
        label="Genre"
        values={d.settings.genres.length > 0 ? d.settings.genres.map(g => g.toUpperCase()) : undefined}
        placeholder="Select genres"
        expanded={openAttr === "genre"}
        onToggle={() => toggle("genre")}
      >
        <div className="chip-row">
          {(["thriller","drama","comedy","horror","sci-fi","romance","action","mystery"] as const).map(g => (
            <button key={g}
              className={`chip ${d.settings.genres.includes(g) ? "selected" : ""}`}
              onClick={() => updateDraft({
                settings: {
                  ...d.settings,
                  genres: d.settings.genres.includes(g)
                    ? d.settings.genres.filter(x => x !== g)
                    : [...d.settings.genres, g],
                },
              })}>
              {g}
            </button>
          ))}
        </div>
      </AttrRow>

      {/* Title */}
      <TextAttrRow
        label="Title"
        value={story.title}
        placeholder="Add a title"
        onChange={v => setStory(s => ({ ...s, title: v }))}
      />

      {/* Logline */}
      <TextAttrRow
        label="Logline"
        value={d.logline}
        placeholder="Add a logline"
        onChange={v => updateDraft({ logline: v })}
        multiline
      />

      {/* Summary */}
      <TextAttrRow
        label="Summary"
        value={d.concept.summary}
        placeholder="Add a premise"
        onChange={v => updateDraft({ concept: { ...d.concept, summary: v } })}
        multiline
      />

      {/* Tone */}
      <TextAttrRow
        label="Tone"
        value={d.concept.tone}
        placeholder="Set the tone"
        onChange={v => updateDraft({ concept: { ...d.concept, tone: v } })}
      />

      {/* Themes */}
      <AttrRow
        label="Themes"
        values={d.concept.themes.length > 0 ? d.concept.themes : undefined}
        placeholder="Add themes"
        expanded={openAttr === "themes"}
        onToggle={() => toggle("themes")}
      >
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {d.concept.themes.map(t => (
            <button key={t} className="chip selected" onClick={() => removeTheme(t)}>
              {t} &#10005;
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="field"
            value={themeInput}
            onChange={e => setThemeInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTheme()}
            placeholder="Add a theme"
            style={{ flex: 1, marginBottom: 0 }}
          />
          <button className="btn-secondary" onClick={addTheme} disabled={!themeInput.trim()}
            style={{ fontSize: 13, padding: "10px 16px", minHeight: 0, flexShrink: 0 }}>
            Add
          </button>
        </div>
      </AttrRow>

      {/* Ending */}
      <AttrRow
        label="Ending"
        values={d.settings.endingTypes.length > 0 ? d.settings.endingTypes.map(e => e.toUpperCase()) : undefined}
        placeholder="Select ending type"
        expanded={openAttr === "ending"}
        onToggle={() => toggle("ending")}
      >
        <div className="chip-row">
          {(["happy","bittersweet","tragic","ambiguous","twist"] as const).map(e => (
            <button key={e}
              className={`chip ${d.settings.endingTypes.includes(e) ? "selected" : ""}`}
              onClick={() => updateDraft({
                settings: {
                  ...d.settings,
                  endingTypes: d.settings.endingTypes.includes(e)
                    ? d.settings.endingTypes.filter(x => x !== e)
                    : [...d.settings.endingTypes, e],
                },
              })}>
              {e}
            </button>
          ))}
        </div>
      </AttrRow>
    </>
  );
}

/* ============================================ */
/* ============ CHARACTERS TAB ================ */
/* ============================================ */

function CharactersTab({
  story,
  setStory,
  run,
  busy,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
}) {
  const d = getActiveCharactersDraft(story);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCharId, setEditingCharId] = useState<string | null>(null);

  function addCharacter() {
    const newChar: Character = {
      id: "ch_" + Math.random().toString(36).slice(2),
      name: "",
      role: "supporting",
      archetype: "",
      backstory: "",
      motivations: "",
      flaws: "",
      want: "",
      need: "",
      relationships: [],
      voice: "",
      arc: "",
      notes: "",
    };
    setStory(s => updateCharactersDraft(s, { characters: [...getActiveCharactersDraft(s).characters, newChar] }));
    setEditingCharId(newChar.id);
    setExpandedId(newChar.id);
  }

  function updateCharacter(id: string, patch: Partial<Character>) {
    setStory(s => updateCharactersDraft(s, {
      characters: getActiveCharactersDraft(s).characters.map(c => c.id === id ? { ...c, ...patch } : c),
    }));
  }

  function removeCharacter(id: string) {
    setStory(s => updateCharactersDraft(s, {
      characters: getActiveCharactersDraft(s).characters.filter(c => c.id !== id),
    }));
    if (expandedId === id) setExpandedId(null);
    if (editingCharId === id) setEditingCharId(null);
  }

  const roleLabels: Record<string, string> = {
    protagonist: "Protagonist",
    antagonist: "Antagonist",
    supporting: "Supporting",
    mentor: "Mentor",
    love_interest: "Love Interest",
    comic_relief: "Comic Relief",
  };

  return (
    <>
      <LayerDraftPicker layer="characters" label="Characters" story={story} setStory={setStory} />

      {d.characters.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>👤</div>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>No characters yet</div>
          <div className="caption" style={{ marginBottom: 16 }}>
            Create your first character to bring your story to life.
          </div>
          <button className="btn-primary" style={{ fontSize: 14, padding: "14px 22px", minHeight: 0 }}
            onClick={addCharacter}>
            + Add character
          </button>
        </div>
      )}

      {d.characters.map(ch => {
        const isExpanded = expandedId === ch.id;
        const isEditing = editingCharId === ch.id;

        return (
          <div key={ch.id} className="card character-card">
            {/* Character header row */}
            <button
              className="character-header"
              onClick={() => setExpandedId(isExpanded ? null : ch.id)}
            >
              <div className="character-avatar">
                {ch.name ? ch.name[0].toUpperCase() : "?"}
              </div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontSize: 15, fontWeight: 900 }}>
                  {ch.name || "Unnamed character"}
                </div>
                <div className="caption">
                  {roleLabels[ch.role] || ch.role || "No role"}
                  {ch.archetype && ` · ${ch.archetype}`}
                </div>
              </div>
              <span className="beat-expand" style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}>›</span>
            </button>

            {isExpanded && (
              <div className="character-body">
                {isEditing ? (
                  <CharacterEditForm
                    character={ch}
                    allCharacters={d.characters}
                    onUpdate={(patch) => updateCharacter(ch.id, patch)}
                    onDone={() => setEditingCharId(null)}
                    onRemove={() => removeCharacter(ch.id)}
                  />
                ) : (
                  <CharacterViewCard
                    character={ch}
                    allCharacters={d.characters}
                    onEdit={() => setEditingCharId(ch.id)}
                    onRemove={() => removeCharacter(ch.id)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {d.characters.length > 0 && (
        <button
          className="btn-secondary"
          style={{ width: "100%", marginTop: 12, fontSize: 13 }}
          onClick={addCharacter}
        >
          + Add character
        </button>
      )}

      {/* Info banner */}
      <div className="info-banner" style={{ marginTop: 16 }}>
        <span className="info-icon">i</span>
        <span>Characters inform AI-generated beats, scenes, and dialogue.</span>
      </div>
    </>
  );
}

/* ── Character view (read-only) ── */

function CharacterViewCard({
  character: ch,
  allCharacters,
  onEdit,
  onRemove,
}: {
  character: Character;
  allCharacters: Character[];
  onEdit: () => void;
  onRemove: () => void;
}) {
  const fields: { label: string; value: string }[] = [
    { label: "Archetype", value: ch.archetype },
    { label: "Backstory", value: ch.backstory },
    { label: "Motivations", value: ch.motivations },
    { label: "Flaws", value: ch.flaws },
    { label: "Want (external)", value: ch.want },
    { label: "Need (internal)", value: ch.need },
    { label: "Voice / Style", value: ch.voice },
    { label: "Arc", value: ch.arc },
    { label: "Notes", value: ch.notes },
  ].filter(f => f.value);

  return (
    <>
      {fields.length === 0 && (
        <div className="caption" style={{ padding: "8px 0" }}>
          No details yet. Tap Edit to add character info.
        </div>
      )}
      {fields.map(f => (
        <div key={f.label} style={{ marginBottom: 10 }}>
          <div className="beat-section-label">{f.label}</div>
          <div className="beat-text">{f.value}</div>
        </div>
      ))}

      {ch.relationships.length > 0 && (
        <>
          <div className="beat-section-label">Relationships</div>
          {ch.relationships.map((r, i) => {
            const other = allCharacters.find(c => c.id === r.characterId);
            return (
              <div key={i} className="inset-card" style={{ marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>{other?.name || "Unknown"}</span>
                <span className="caption" style={{ marginLeft: 8 }}>{r.description}</span>
              </div>
            );
          })}
        </>
      )}

      <div className="beat-actions" style={{ marginTop: 12 }}>
        <button className="btn-primary" style={{ fontSize: 12, padding: "8px 14px", minHeight: 0 }}
          onClick={onEdit}>Edit</button>
        <button className="btn-secondary"
          style={{ fontSize: 12, padding: "8px 14px", minHeight: 0, color: "var(--ink-mute)" }}
          onClick={onRemove}>Remove</button>
      </div>
    </>
  );
}

/* ── Character edit form ── */

function CharacterEditForm({
  character: ch,
  allCharacters,
  onUpdate,
  onDone,
  onRemove,
}: {
  character: Character;
  allCharacters: Character[];
  onUpdate: (patch: Partial<Character>) => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const roles = ["protagonist", "antagonist", "supporting", "mentor", "love_interest", "comic_relief"];

  return (
    <div className="stack">
      <input className="field" placeholder="Name" value={ch.name}
        onChange={e => onUpdate({ name: e.target.value })} />

      <div className="select-wrap">
        <select className="field" value={ch.role}
          onChange={e => onUpdate({ role: e.target.value })}>
          {roles.map(r => (
            <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      <input className="field" placeholder="Archetype (e.g. the mentor, the trickster)"
        value={ch.archetype} onChange={e => onUpdate({ archetype: e.target.value })} />

      <textarea className="field" placeholder="Backstory" value={ch.backstory}
        onChange={e => onUpdate({ backstory: e.target.value })} rows={3} />

      <textarea className="field" placeholder="Motivations" value={ch.motivations}
        onChange={e => onUpdate({ motivations: e.target.value })} rows={2} />

      <textarea className="field" placeholder="Flaws" value={ch.flaws}
        onChange={e => onUpdate({ flaws: e.target.value })} rows={2} />

      <input className="field" placeholder="What they want (external)" value={ch.want}
        onChange={e => onUpdate({ want: e.target.value })} />

      <input className="field" placeholder="What they need (internal)" value={ch.need}
        onChange={e => onUpdate({ need: e.target.value })} />

      <textarea className="field" placeholder="Voice / speaking style" value={ch.voice}
        onChange={e => onUpdate({ voice: e.target.value })} rows={2} />

      <textarea className="field" placeholder="Character arc" value={ch.arc}
        onChange={e => onUpdate({ arc: e.target.value })} rows={2} />

      <textarea className="field" placeholder="Additional notes" value={ch.notes}
        onChange={e => onUpdate({ notes: e.target.value })} rows={2} />

      <div className="beat-actions" style={{ marginTop: 4 }}>
        <button className="btn-primary" style={{ fontSize: 13, padding: "10px 18px", minHeight: 0 }}
          onClick={onDone}>Done</button>
        <button className="btn-secondary"
          style={{ fontSize: 12, padding: "8px 14px", minHeight: 0, color: "var(--ink-mute)" }}
          onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

/* ============================================ */
/* ============ STORY TAB ===================== */
/* ============================================ */

function StoryTab({
  story, setStory,
  beats, moments, addBeat, updateBeat, moveBeat, removeBeat,
  unlinkMoment, openMomentPicker, openBeatTray, run, busy, syncState,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
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
  syncState: LayerSyncState;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ beatId: string; field: "name" | "summary" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartY = useRef(0);
  const touchOffsetY = useRef(0);
  const isDragActive = useRef(false);
  const beatRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cloneRef = useRef<HTMLDivElement | null>(null);

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
      <LayerDraftPicker layer="story" label="Story" story={story} setStory={setStory} />

      {/* Out-of-sync banner */}
      {syncState.storyOutOfSync && (
        <div className="sync-banner">
          <div className="sync-banner-text">
            <span className="sync-dot inline" />
            Concept or Characters were updated. Your beat sheet may be out of date.
          </div>
        </div>
      )}

      <div className={draggingIdx != null ? "beats-dragging" : ""}>
        {beats.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>&#9670;</div>
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
              {/* Drop indicator before this beat */}
              <div className={`beat-drop-indicator ${draggingIdx != null && dropTargetIdx === i && dropTargetIdx !== draggingIdx && dropTargetIdx !== draggingIdx + 1 ? "active" : ""}`} />
              <div
                className={`beat-card ${isExpanded ? "expanded" : ""} ${isDragging ? "dragging" : ""}`}
                onTouchStart={(e) => {
                  const y = e.touches[0].clientY;
                  touchStartY.current = y;
                  isDragActive.current = false;
                  const cardEl = beatRefs.current[i]?.querySelector(".beat-card") as HTMLElement | null;
                  longPressTimer.current = setTimeout(() => {
                    isDragActive.current = true;
                    setDraggingIdx(i);
                    setDropTargetIdx(i);
                    setExpanded(null);
                    if (cardEl) {
                      const rect = cardEl.getBoundingClientRect();
                      touchOffsetY.current = y - rect.top;
                      const clone = cardEl.cloneNode(true) as HTMLDivElement;
                      clone.className = "beat-drag-clone";
                      clone.style.top = `${rect.top}px`;
                      clone.style.width = `${rect.width}px`;
                      document.body.appendChild(clone);
                      cloneRef.current = clone;
                    }
                  }, 400);
                }}
                onTouchMove={(e) => {
                  const y = e.touches[0].clientY;
                  if (longPressTimer.current && Math.abs(y - touchStartY.current) > 8) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }
                  if (!isDragActive.current) return;
                  e.preventDefault();
                  if (cloneRef.current) {
                    cloneRef.current.style.top = `${y - touchOffsetY.current}px`;
                  }
                  let target = draggingIdx ?? i;
                  for (let j = 0; j < beats.length; j++) {
                    const el = beatRefs.current[j];
                    if (!el) continue;
                    const rect = el.getBoundingClientRect();
                    const mid = rect.top + rect.height / 2;
                    if (y < mid) { target = j; break; }
                    target = j + 1;
                  }
                  target = Math.max(0, Math.min(beats.length, target));
                  setDropTargetIdx(target);
                }}
                onTouchEnd={() => {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }
                  if (cloneRef.current) {
                    cloneRef.current.remove();
                    cloneRef.current = null;
                  }
                  if (isDragActive.current && draggingIdx != null && dropTargetIdx != null && dropTargetIdx !== draggingIdx && dropTargetIdx !== draggingIdx + 1) {
                    const fromIdx = draggingIdx;
                    const toIdx = dropTargetIdx > fromIdx ? dropTargetIdx - 1 : dropTargetIdx;
                    if (fromIdx !== toIdx) {
                      let diff = toIdx - fromIdx;
                      let cur = fromIdx;
                      while (diff > 0) { moveBeat(cur, "down"); cur++; diff--; }
                      while (diff < 0) { moveBeat(cur, "up"); cur--; diff++; }
                    }
                  }
                  isDragActive.current = false;
                  setDraggingIdx(null);
                  setDropTargetIdx(null);
                }}
              >
                <div className="beat-header" style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  <div className="beat-grip" aria-hidden="true">&#10303;</div>
                  <button
                    style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, padding: "16px 16px 16px 4px", textAlign: "left", background: "none", border: "none" }}
                    onClick={() => { if (!isDragActive.current) setExpanded(isExpanded ? null : beat.id); }}
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
                              onClick={() => unlinkMoment(beat.id, m.id)} aria-label="Unlink">&#10005;</button>
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
                        onClick={() => moveBeat(i, "up")} aria-label="Move up">&#8593;</button>
                      <button className="reorder-btn" disabled={i === beats.length - 1}
                        onClick={() => moveBeat(i, "down")} aria-label="Move down">&#8595;</button>
                    </div>
                  </div>
                )}
              </div>

              {i === beats.length - 1 && (
                <div className={`beat-drop-indicator ${draggingIdx != null && dropTargetIdx === beats.length && dropTargetIdx !== draggingIdx && dropTargetIdx !== draggingIdx + 1 ? "active" : ""}`} />
              )}

              <div className="beat-insert-row">
                <button
                  className="beat-insert-btn"
                  onClick={() => openBeatTray(i + 1)}
                  aria-label="Insert beat here"
                >
                  + Add beat
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================ */
/* ============ SCRIPT TAB ==================== */
/* ============================================ */

function ScriptTab({
  story,
  setStory,
  beats,
  run,
  busy,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  beats: Beat[];
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
}) {
  const d = getActiveScriptDraft(story);
  const syncState = getLayerSyncState(story);
  const writtenCount = beats.filter(b => b.status === "written").length;
  const isOutOfSync = syncState.scriptOutOfSync;

  function dismissSync() {
    setStory(s => markLayerSynced(s, "script"));
  }

  return (
    <>
      <LayerDraftPicker layer="script" label="Script" story={story} setStory={setStory} />

      {/* Out-of-sync banner */}
      {isOutOfSync && (
        <div className="sync-banner">
          <div className="sync-banner-text">
            <span className="sync-dot inline" />
            Upstream content was updated.
            <br />Your script may need to be refreshed.
          </div>
          <div className="sync-banner-actions">
            <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 12px", minHeight: 0 }}
              onClick={dismissSync}>
              Keep current draft
            </button>
          </div>
        </div>
      )}

      <div className="caption" style={{ marginBottom: 14 }}>
        {writtenCount}/{beats.length} scenes written.
      </div>

      {beats.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
          <div className="caption">No beats yet. Go to <b>Story</b> to structure first.</div>
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
            onClick={() => run({ type: "add_twist", payload: {} }, "Add twist")}>&#9889; Add twist</button>
          <button className="btn-secondary" disabled={busy} style={{ flex: 1, fontSize: 13 }}
            onClick={() => run(
              { type: "brainstorm", payload: { prompt: "ways to deepen the conflict" } },
              "Brainstorm"
            )}>&#9998; Brainstorm</button>
        </div>
      )}

      {/* Info banner */}
      <div className="info-banner" style={{ marginTop: 16 }}>
        <span className="info-icon">i</span>
        <span>Script uses your Concept, Characters, and Story as inputs for AI generation.</span>
      </div>
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
        position: getActiveStoryLayerDraft(story).beats.length,
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

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <textarea className="field" placeholder="Describe this beat"
          value={summary} onChange={e => setSummary(e.target.value)} rows={4}
          style={{ flex: 1, marginBottom: 0 }} />
        <button
          className={`record-fab ${recording ? "recording" : ""}`}
          onClick={toggleRecord}
          style={{ position: "static", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", width: 52, height: 52, flexShrink: 0 }}
        >
          <div className="red-dot" style={{ width: 22, height: 22 }} />
        </button>
      </div>
      {recording && (
        <div className="caption" style={{ textAlign: "right" }}>Listening... tap to stop</div>
      )}

      {summary.trim() && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={cleanUp}
            disabled={cleaning || busy || generating}
            style={{ fontSize: 13, flex: 1 }}>
            {cleaning ? "Cleaning..." : "Clean up"}
          </button>
          <button className="btn-secondary"
            onClick={() => { setName(""); setSummary(""); }}
            style={{ fontSize: 13 }}>
            Redo
          </button>
        </div>
      )}

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
              {generating ? "Creating..." : "Create"}
            </button>
            <button className="btn-secondary" onClick={() => setShowAISettings(false)}
              style={{ fontSize: 13, padding: "12px 16px", minHeight: 0 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button className="btn-secondary"
          onClick={() => setShowAISettings(true)}
          disabled={busy || generating}
          style={{ fontSize: 13, flex: 1 }}>
          {generating ? "Creating..." : "Create with AI"}
        </button>
        <button className="btn-primary" onClick={() => onSave(name || "Untitled beat", summary)}
          disabled={!summary.trim()}
          style={{ fontSize: 13, padding: "12px 20px", minHeight: 0 }}>
          Save
        </button>
      </div>
    </div>
  );
}

/* ============================================ */
/* ============ SETTINGS TAB ================== */
/* ============================================ */

function SettingsTab({
  story, setStory,
  onLoadProjectDraft, onDeleteProjectDraft, onCreateProjectFromDraft,
  onSwitchLayerDraft, onDeleteLayerDraft,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  onLoadProjectDraft: (id: string) => void;
  onDeleteProjectDraft: (id: string) => void;
  onCreateProjectFromDraft: (id: string) => void;
  onSwitchLayerDraft: (layer: LayerKey, id: string) => void;
  onDeleteLayerDraft: (layer: LayerKey, id: string) => void;
}) {
  const concept = getActiveConceptDraft(story);
  const storyLayer = getActiveStoryLayerDraft(story);
  const s = concept.settings;
  const [generatingCover, setGeneratingCover] = useState(false);

  const setSettingField = <K extends keyof StorySettings>(k: K, v: StorySettings[K]) =>
    setStory(st => updateConceptDraft(st, { settings: { ...getActiveConceptDraft(st).settings, [k]: v } }));

  async function generateCover() {
    setGeneratingCover(true);
    try {
      const res = await fetch("/api/generate-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: story.title,
          logline: concept.logline,
          genres: concept.settings.genres,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.thumbnail) {
        setStory(st => ({ ...st, thumbnail: data.thumbnail }));
      }
    } catch {} finally {
      setGeneratingCover(false);
    }
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const renderLayerDrafts = (layer: LayerKey, label: string) => {
    const pool: any[] = (
      layer === "concept"    ? story.conceptDrafts :
      layer === "characters" ? story.charactersDrafts :
      layer === "story"      ? story.storyDrafts :
                               story.scriptDrafts
    );
    const pd = getActiveProjectDraft(story);
    const activeId =
      layer === "concept"    ? pd.conceptDraftId :
      layer === "characters" ? pd.charactersDraftId :
      layer === "story"      ? pd.storyDraftId :
                               pd.scriptDraftId;
    const refKey =
      layer === "concept"    ? "conceptDraftId" :
      layer === "characters" ? "charactersDraftId" :
      layer === "story"      ? "storyDraftId" :
                               "scriptDraftId";
    const sorted = [...pool].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return (
      <div className="card">
        <span className="eyebrow">{label} Drafts</span>
        <div className="stack" style={{ marginTop: 10 }}>
          {sorted.map(d => {
            const isActive = d.id === activeId;
            const referenced = story.projectDrafts.some((pd: any) => pd[refKey] === d.id);
            const canDelete = pool.length > 1 && !referenced;
            return (
              <div key={d.id} className="inset-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      Draft {d.number}
                      {isActive && <span className="caption" style={{ marginLeft: 8 }}>· Active</span>}
                    </div>
                    <div className="caption" style={{ marginTop: 2 }}>
                      Edited {formatDate(d.updatedAt)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!isActive && (
                    <button className="btn-secondary"
                      style={{ fontSize: 12, padding: "6px 12px", minHeight: 0 }}
                      onClick={() => onSwitchLayerDraft(layer, d.id)}>
                      Load
                    </button>
                  )}
                  {canDelete && (
                    <button className="btn-secondary"
                      style={{ fontSize: 12, padding: "6px 12px", minHeight: 0, color: "var(--record)" }}
                      onClick={() => {
                        if (confirm(`Delete ${label} Draft ${d.number}?`)) onDeleteLayerDraft(layer, d.id);
                      }}>
                      Delete
                    </button>
                  )}
                  {referenced && !isActive && (
                    <span className="caption" style={{ alignSelf: "center", color: "var(--ink-mute)" }}>
                      Referenced by project draft(s)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const sortedProjectDrafts = [...story.projectDrafts].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <>
      <div className="display" style={{ marginBottom: 18 }}>Settings</div>

      <div className="card">
        <span className="eyebrow">Cover</span>
        {story.thumbnail && (
          <img src={story.thumbnail} alt="" style={{ width: "100%", borderRadius: 12, marginBottom: 10 }} />
        )}
        <button className="btn-secondary" onClick={generateCover}
          disabled={generatingCover}
          style={{ width: "100%", fontSize: 13 }}>
          {generatingCover ? "Generating..." : story.thumbnail ? "Regenerate cover" : "Generate cover"}
        </button>
      </div>

      <div className="card">
        <span className="eyebrow">Framework</span>
        <div className="select-wrap">
          <select className="field" value={s.framework}
            onChange={e => setSettingField("framework", e.target.value as any)}>
            <option value="save-the-cat">Save the Cat</option>
            <option value="heros-journey">Hero&apos;s Journey</option>
            <option value="three-act">Three Act</option>
            <option value="story-circle">Story Circle</option>
          </select>
        </div>
      </div>

      <div className="card">
        <span className="eyebrow">Vibe</span>
        <input className="field" value={s.vibe}
          onChange={e => setSettingField("vibe", e.target.value)} placeholder="Describe the vibe" />
      </div>

      <div className="card">
        <span className="eyebrow">Dials</span>
        <div className="stack" style={{ marginTop: 8 }}>
          <Slider label="Unpredictability" value={s.unpredictability} onChange={v => setSettingField("unpredictability", v)} />
          <Slider label="Darkness"         value={s.darkness}         onChange={v => setSettingField("darkness", v)} />
          <Slider label="Pace"             value={s.pace}             onChange={v => setSettingField("pace", v)} />
        </div>
      </div>

      <div className="card">
        <span className="eyebrow">Ingredients</span>
        {storyLayer.ingredients.length === 0 && (
          <div className="caption" style={{ marginTop: 4 }}>No ingredients yet.</div>
        )}
        {storyLayer.ingredients.map(ing => (
          <div key={ing.id} className="inset-card">
            <div className="eyebrow">{ing.label} {ing.locked && "· locked"}</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{ing.description}</div>
          </div>
        ))}
      </div>

      {/* Project drafts */}
      <div className="card">
        <span className="eyebrow">Project Drafts</span>
        <div className="stack" style={{ marginTop: 10 }}>
          {sortedProjectDrafts.map(draft => {
            const isActive = draft.id === story.activeProjectDraftId;
            const canDelete = story.projectDrafts.length > 1;
            return (
              <div key={draft.id} className="inset-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      Draft {draft.number}
                      {isActive && <span className="caption" style={{ marginLeft: 8 }}>· Active</span>}
                    </div>
                    <div className="caption" style={{ marginTop: 2 }}>
                      Edited {formatDate(draft.updatedAt)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!isActive && (
                    <button className="btn-secondary"
                      style={{ fontSize: 12, padding: "6px 12px", minHeight: 0 }}
                      onClick={() => onLoadProjectDraft(draft.id)}>
                      Load
                    </button>
                  )}
                  <button className="btn-secondary"
                    style={{ fontSize: 12, padding: "6px 12px", minHeight: 0 }}
                    onClick={() => onCreateProjectFromDraft(draft.id)}>
                    New project from this
                  </button>
                  {canDelete && (
                    <button className="btn-secondary"
                      style={{ fontSize: 12, padding: "6px 12px", minHeight: 0, color: "var(--record)" }}
                      onClick={() => {
                        if (confirm(`Delete Project Draft ${draft.number}?`)) onDeleteProjectDraft(draft.id);
                      }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {renderLayerDrafts("concept",    "Concept")}
      {renderLayerDrafts("characters", "Characters")}
      {renderLayerDrafts("story",      "Story")}
      {renderLayerDrafts("script",     "Script")}
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
