"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  Story, Beat, Episode, Character, CharacterRelationship, Scene, StorySettings, Reference,
  ConceptLayerDraft, CharactersLayerDraft, StoryLayerDraft, ScriptLayerDraft, ProjectDraft,
  LayerKey, LayerSyncState,
  getActiveProjectDraft,
  getActiveConceptDraft, getActiveCharactersDraft, getActiveStoryLayerDraft, getActiveScriptDraft,
  updateConceptDraft, updateCharactersDraft, updateStoryLayerDraft, updateScriptDraft,
  createNewLayerDraft, switchLayerDraft, deleteLayerDraft,
  createNewProjectDraft, duplicateActiveProjectDraft, createEmptyProjectDraft, switchProjectDraft, deleteProjectDraft,
  saveLayerDraft, isLayerDraftDirty,
  saveProjectDraft, isProjectDraftDirty,
  isLayerChangedForTabDot, isConceptFieldDirty, ConceptField,
  getLayerSyncState, markLayerSynced,
  isLayerDraftEmpty,
  applySyncResult,
} from "@/lib/story";
import {
  syncLayer,
  syncLayers,
  importExtractScenes,
  importSummarizeScenesIntoBeats,
} from "@/lib/syncLayer";
import {
  extractTextFromFile,
  IMPORT_ACCEPT,
} from "@/lib/scriptImport";
import { parseScreenplay } from "@/lib/scriptParse";
import { subGenresFor, SUB_GENRES_BY_ID } from "@/lib/subGenres";
import { REFERENCE_ASPECTS, WRITER_STYLES } from "@/lib/references";
import { createProjectFromDraft } from "@/lib/storage";
import { Moment } from "@/lib/sampleData";
import { ActionRequest } from "@/lib/prompt";
import { useProfileCapture } from "@/lib/writerProfileStore";
import type { ProfileExemplar } from "@/lib/writerProfile";
import { Button, Input, Textarea, Selector } from "@/components/ui";
import { SpeakButton } from "@/components/SpeakButton";

type Section = "concept" | "characters" | "story" | "script";

export function Studio({
  story,
  setStory,
  moments,
  onBack,
  isNew = false,
  isFirstProject = false,
  onOnboardingSeen,
  onCreateProjectFromDraft,
  onDeleteProject,
  autosaveEnabled = true,
  onEmailProject,
  emailProjectBusy = false,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  moments: Moment[];
  onBack: () => void;
  isNew?: boolean;
  /** True only for the user's very first project. Drives the one-time
   *  welcome/onboarding sheet that explains drafts + Update Other Layers.
   *  Must be combined with `isNew` for the sheet to show — we only greet
   *  the user at the moment of creation, not on every re-entry. */
  isFirstProject?: boolean;
  /** Fires when the user dismisses the welcome sheet. Parent persists
   *  the "has seen onboarding" flag so the sheet never appears again. */
  onOnboardingSeen?: () => void;
  onCreateProjectFromDraft?: (newStory: Story) => void;
  onDeleteProject?: () => void;
  autosaveEnabled?: boolean;
  /** Fires when the user taps the email-icon in the top nav. The
   *  parent (app/page.tsx) owns the fetch + toast; Studio just
   *  invokes the callback and shows a pulsing state via `busy`. */
  onEmailProject?: () => void;
  emailProjectBusy?: boolean;
}) {
  const [section, setSection] = useState<Section>("concept");
  // Writer-profile capture API — used to attach the profile to every AI
  // request and to pass profile-awareness down to tab components.
  const { profile } = useProfileCapture();
  // First-project welcome/onboarding sheet — shown exactly once in the
  // user's lifetime, right after they create their very first project.
  // Explains what drafts are + how Update Other Layers works so they
  // understand the layer model before they start editing. Dismissal
  // calls onOnboardingSeen() so the parent persists the "seen" flag.
  const [showWelcome, setShowWelcome] = useState(isNew && isFirstProject);
  function dismissWelcome() {
    setShowWelcome(false);
    onOnboardingSeen?.();
  }
  // "Project Created" toast — shown briefly after a new project is
  // created, then auto-hides. Mirrors the Idea-Added toast on the
  // main page; rendered at Studio root so it floats over any tab.
  // Suppressed when the welcome sheet is showing: the sheet itself is
  // the confirmation in that case, and stacking the toast under it is
  // redundant and visually noisy.
  const [showSuccess, setShowSuccess] = useState(isNew && !(isNew && isFirstProject));
  useEffect(() => {
    if (!showSuccess) return;
    const t = setTimeout(() => setShowSuccess(false), 2000);
    return () => clearTimeout(t);
  }, [showSuccess]);
  const [draftsDropdownOpen, setDraftsDropdownOpen] = useState(false);
  // Mutual exclusion between the project-drafts dropdown and any
  // LayerDraftPicker dropdown: whenever one opens, it broadcasts a
  // "draft-dropdown:open" event with its own id, and every other
  // dropdown closes itself. Keeps only one list on screen at a time.
  useEffect(() => {
    if (draftsDropdownOpen) {
      window.dispatchEvent(
        new CustomEvent("draft-dropdown:open", { detail: "project" }),
      );
    }
    const onOther = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== "project") setDraftsDropdownOpen(false);
    };
    window.addEventListener("draft-dropdown:open", onOther);
    return () => window.removeEventListener("draft-dropdown:open", onOther);
  }, [draftsDropdownOpen]);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !thumbRef.current) return;
    const y = scrollRef.current.scrollTop;
    thumbRef.current.style.opacity = `${Math.max(0, 1 - y / 60)}`;
  }, []);

  // Reset scroll position when entering a project (or switching to a different one).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [story.id]);

  // Measure pinned header height so the LayerDraftPicker can stick right below it.
  // The header pins at top: -44px, so its fully-pinned visible bottom is at (height - 44).
  useEffect(() => {
    const header = headerRef.current;
    const scroll = scrollRef.current;
    if (!header || !scroll) return;
    const update = () => {
      const pinnedBottom = Math.max(0, header.offsetHeight - 44);
      scroll.style.setProperty("--draft-picker-top", `${pinnedBottom}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTitle, setSheetTitle] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBeatId, setPickerBeatId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [beatTrayOpen, setBeatTrayOpen] = useState(false);
  const [beatTrayInsertAt, setBeatTrayInsertAt] = useState<number | null>(null);
  // Character sheet — a single sheet used for BOTH creation and editing.
  // null = closed. "new-char-draft" marker or an existing character id = open.
  const [charSheetCharId, setCharSheetCharId] = useState<string | null>(null);
  // TV show episode drill-in
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  // Update-Other-Layers tray: null = closed, otherwise the source layer driving the sync.
  const [updateTraySource, setUpdateTraySource] = useState<LayerKey | null>(null);
  // Read-through player sheet (Script tab): shows the full script formatted
  // for reading with per-character voice playback.
  const [readThroughOpen, setReadThroughOpen] = useState(false);
  // Script-import pipeline state. `importing` drives the CTA's spinner;
  // `importStep` is whichever derived-layer is currently in flight so we
  // can show "Generating Concept…" etc. in the card.
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState<LayerKey | null>(null);

  // Active layer drafts — where all editing happens
  const activeProjectDraft = getActiveProjectDraft(story);
  const activeConcept      = getActiveConceptDraft(story);
  const activeCharacters   = getActiveCharactersDraft(story);
  const activeStoryLayer   = getActiveStoryLayerDraft(story);
  const activeScriptDraft  = getActiveScriptDraft(story);
  const syncState          = getLayerSyncState(story);

  // ── Autosave ──
  // When enabled, every edit to `story` is immediately "saved" by bumping
  // savedAt to match updatedAt on any dirty layer, and on the project draft
  // itself. This removes the need for manual save buttons and dirty dots.
  // The effect is idempotent: once everything is clean, isLayerDraftDirty
  // returns false for all layers and the effect short-circuits without
  // triggering another render.
  useEffect(() => {
    if (!autosaveEnabled || !story) return;

    let next = story;
    if (isLayerDraftDirty(getActiveConceptDraft(next)))        next = saveLayerDraft(next, "concept");
    if (isLayerDraftDirty(getActiveCharactersDraft(next)))     next = saveLayerDraft(next, "characters");
    if (isLayerDraftDirty(getActiveStoryLayerDraft(next)))     next = saveLayerDraft(next, "story");
    if (isLayerDraftDirty(getActiveScriptDraft(next)))         next = saveLayerDraft(next, "script");
    if (isProjectDraftDirty(next))                             next = saveProjectDraft(next);

    if (next !== story) setStory(() => next);
  }, [story, autosaveEnabled, setStory]);

  // ── Writer-profile prose capture ──────────────────────────────────
  // Debounced 2.5s after any story change, walk the active drafts and
  // submit any new prose fragments to the writer profile. A local ref
  // set dedupes by (kind + text) so the same logline isn't counted
  // multiple times across re-saves. `captureStyle` is internally safe
  // to call with short/empty text (it no-ops below threshold).
  const styleCaptureRef = useRef<Set<string>>(new Set());
  const { captureStyle: captureStyleStudio } = useProfileCapture();
  useEffect(() => {
    if (!story) return;
    const t = setTimeout(() => {
      const capIfNew = (text: string | undefined | null, kind: ProfileExemplar["kind"]) => {
        const v = (text ?? "").trim();
        if (v.length < 20) return;
        const sig = kind + ":" + v;
        if (styleCaptureRef.current.has(sig)) return;
        styleCaptureRef.current.add(sig);
        captureStyleStudio(v, kind);
      };

      const concept = getActiveConceptDraft(story);
      capIfNew(concept.logline, "logline");
      capIfNew(concept.concept?.summary, "summary");

      const chars = getActiveCharactersDraft(story);
      for (const c of chars.characters) {
        // Concatenate the free-prose character fields into one sample —
        // the user's voice shows most clearly across backstory + voice
        // + arc, not in their label-like fields.
        const blob = [c.backstory, c.motivations, c.flaws, c.voice, c.arc, c.notes]
          .filter(Boolean)
          .join("\n\n");
        capIfNew(blob, "character");
      }

      const storyL = getActiveStoryLayerDraft(story);
      const beats = story.projectType === "tv-show"
        ? (storyL.episodes ?? []).flatMap(ep => ep.beats)
        : storyL.beats;
      for (const b of beats) {
        capIfNew(b.summary, "beat");
        if (b.sceneContent) capIfNew(b.sceneContent, "scene");
      }

      const script = getActiveScriptDraft(story);
      if (script) {
        for (const s of script.script.scenes) {
          capIfNew(s.content, "scene");
        }
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [story, captureStyleStudio]);

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
    // "New Draft" = fresh empty project draft: new empty layer drafts
    // across all four layers, but project-level identity (title, format,
    // genres) is carried forward. Genres are preserved on the new Concept
    // draft's settings; title + projectType live on Story itself so they
    // naturally persist.
    setStory(s => createEmptyProjectDraft(s));
    setDraftsDropdownOpen(false);
  };
  const handleDuplicateProjectDraft = () => {
    // Deep-copy the active project draft: new PD + fresh clones of all
    // four layer drafts, so edits to the new draft don't leak back into
    // the source.
    setStory(s => duplicateActiveProjectDraft(s));
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

  // ── Character sheet open/close ──
  // Creating a character = optimistically insert a blank record, open its sheet,
  // and discard on close if nothing was filled in. Editing = open by id.
  const openExistingCharacterSheet = (id: string) => setCharSheetCharId(id);
  const openNewCharacterSheet = () => {
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
    setStory(s => updateCharactersDraft(s, {
      characters: [...getActiveCharactersDraft(s).characters, newChar],
    }));
    setCharSheetCharId(newChar.id);
  };
  const closeCharacterSheet = () => {
    const id = charSheetCharId;
    if (!id) return;
    // Auto-discard a blank character (no name + no details filled in).
    setStory(s => {
      const chars = getActiveCharactersDraft(s).characters;
      const ch = chars.find(c => c.id === id);
      if (!ch) return s;
      const isBlank =
        !ch.name.trim() && !ch.archetype && !ch.backstory && !ch.motivations &&
        !ch.flaws && !ch.want && !ch.need && !ch.voice && !ch.arc && !ch.notes &&
        ch.relationships.length === 0;
      if (!isBlank) return s;
      return updateCharactersDraft(s, {
        characters: chars.filter(c => c.id !== id),
      });
    });
    setCharSheetCharId(null);
  };

  // Script-import pipeline — 4 explicit sequential steps.
  //
  //   Step 1 (script):    AI identifies scene line-ranges in the raw
  //                       file text. Client SLICES the original lines
  //                       by those ranges, so each scene's `content`
  //                       is guaranteed word-for-word faithful to the
  //                       source — the LLM only emits integers, never
  //                       prose, so there's no paraphrasing risk.
  //
  //   Step 2 (story):     AI writes one beat per scene, in order, with
  //                       a 2–5-word beat name, a 1–2-sentence summary,
  //                       and a 1-sentence purpose. Client zips the
  //                       returned beats 1:1 with the scenes.
  //
  //   Step 3 (characters): Standard `sync_script_to_characters`. The
  //                       model has the full scene prose + beats to
  //                       reason over, so it returns a rich cast with
  //                       motives, backstory, voice, arc, etc.
  //
  //   Step 4 (concept):    Standard `sync_script_to_concept`. Title,
  //                       format, and genres are preserved because (a)
  //                       title + projectType live at the top level of
  //                       Story and are never touched by sync writes,
  //                       and (b) `normalizeConceptPatch` in syncLayer
  //                       strips title/projectType/genres from the
  //                       model's output before applying. The new
  //                       concept draft is cloned from the active one
  //                       via `createNewConceptDraft`, so the existing
  //                       settings (genres included) come along for
  //                       free. Only logline/summary/tone/themes/
  //                       endingTypes are rewritten.
  //
  // Empty/new-draft rule: each step passes the PRE-IMPORT `story` as
  // the empty-check baseline, so "empty → overwrite in place; non-empty
  // → new draft" fires correctly per layer regardless of order.
  //
  // Lands the user on the Script tab so the faithful scene split is the
  // first thing they see.
  async function importScriptFromFile(file: File) {
    if (importing) return;
    setImporting(true);
    setImportStep(null);
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) {
        throw new Error(
          "No text could be extracted from this file. If it's a PDF, " +
          "its text layer may be image-based (scanned) — try re-exporting " +
          "from your screenwriting app as a text-based PDF or .txt."
        );
      }

      // ── Step 1: Scenes (word-for-word) ─────────────────────────
      setImportStep("script");
      const scenes = await importExtractScenes(story, text, profile);
      if (scenes.length === 0) {
        const preview = text.trim().slice(0, 180).replace(/\s+/g, " ");
        throw new Error(
          "The AI could not identify any scenes in this file. The script " +
          "must be in standard screenplay format with scene slugs " +
          "(INT./EXT./EST.) at the start of each scene.\n\n" +
          `Extracted preview: "${preview}${text.length > 180 ? "…" : ""}"`
        );
      }
      let next = applySyncResult(story, { kind: "script", scenes }, story);

      // ── Step 2: One beat per scene, with AI summary ────────────
      setImportStep("story");
      const rawBeats = await importSummarizeScenesIntoBeats(next, profile);

      // Imported scripts are already written — pair each beat with its
      // scene (they are 1:1 in order), carry the scene prose onto the
      // beat as `sceneContent`, and flip status to "written" so the
      // Script tab renders the prose instead of a "Write this scene"
      // button. Also link each scene's `beatId` back to its matching
      // beat so the cross-layer sync banner has a valid anchor.
      const scriptDraftAfterStep1 = getActiveScriptDraft(next);
      const rawScenes = scriptDraftAfterStep1?.script.scenes ?? [];
      const beats = rawBeats.map((b, i) => ({
        ...b,
        status: "written" as const,
        sceneContent: rawScenes[i]?.content ?? "",
      }));
      const linkedScenes = rawScenes.map((s, i) => ({
        ...s,
        beatId: beats[i]?.id ?? null,
      }));
      // Patch scene.beatId in place on the active script draft —
      // avoids branching a second Script draft. Preserve the other
      // fields on `script` (syncStatus etc.) by spreading the existing
      // object before overriding `scenes`.
      if (scriptDraftAfterStep1) {
        next = updateScriptDraft(next, {
          script: { ...scriptDraftAfterStep1.script, scenes: linkedScenes },
        });
      }

      if (story.projectType === "tv-show") {
        // TV keeps beats on episodes, not top-level. Drop the whole
        // imported script into a single Episode 1 — the user can rename
        // or split into additional episodes afterward.
        const episodeId = `ep_${Math.random().toString(36).slice(2, 10)}`;
        next = applySyncResult(next, {
          kind: "story",
          beats: [],
          episodes: [{ id: episodeId, title: "Episode 1", number: 1, beats }],
        }, story);
      } else {
        next = applySyncResult(next, { kind: "story", beats }, story);
      }

      // ── Step 3: Rich characters from scenes + beats ────────────
      setImportStep("characters");
      next = await syncLayer(next, "script", "characters", profile);

      // ── Step 4: Fresh Concept draft (title/format/genres kept) ──
      setImportStep("concept");
      next = await syncLayer(next, "script", "concept", profile);

      setStory(() => next);
      setSection("script");
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") {
        window.alert(`Script import failed:\n\n${msg}`);
      }
    } finally {
      setImporting(false);
      setImportStep(null);
    }
  }

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
        body: JSON.stringify({ story, action, profile }),
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
  function addBeat(name: string, summary: string, insertAt?: number, characterIds?: string[]) {
    const newBeat: Beat = {
      id: "b_" + Math.random().toString(36).slice(2),
      name, summary, purpose: "",
      position: 0, momentIds: [],
      characterIds: characterIds ?? [],
      status: "design",
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
        <SectionTabs section={section} setSection={setSection} story={story} />
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
            <Button variant="secondary" size="lg" style={{ width: "100%", marginTop: 12 }}
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
            </Button>
          </div>
        </div>
      </>
    );
  }

  // Setup view
  const confirmDeleteDialog = confirmDeleteProject ? (
    <>
      <div className="confirm-backdrop" onClick={() => setConfirmDeleteProject(false)} />
      <div className="confirm-dialog">
        <div className="confirm-title">Are you sure?</div>
        <div className="confirm-body">
          This will permanently delete &quot;{story.title || "this project"}&quot; and all of its drafts.
          This action cannot be undone.
        </div>
        <div className="confirm-actions">
          <Button variant="secondary" size="sm"
            onClick={() => setConfirmDeleteProject(false)}>
            Cancel
          </Button>
          <button className="btn-delete-project"
            onClick={() => {
              setConfirmDeleteProject(false);
              onDeleteProject?.();
            }}>
            Delete Project
          </button>
        </div>
      </div>
    </>
  ) : null;

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
              onDeleteLayerDraft={handleDeleteLayerDraft}
              onRequestDeleteProject={() => setConfirmDeleteProject(true)}
              onEmailProject={onEmailProject}
              emailProjectBusy={emailProjectBusy}
            />
          </div>
        </div>
        {confirmDeleteDialog}
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
        {/* Email this project lives inside the Settings panel now — the
            top-nav used to carry an envelope icon but it's been folded
            into Settings to keep the nav light. The `onEmailProject`
            callback threads through to `SettingsTab`. */}
        <button className="project-header-btn" onClick={() => setShowSetup(true)} aria-label="Settings">
          <img src="/settings-icon.svg" alt="" style={{ width: 17, height: 14 }} />
        </button>
        {/* Help question-mark icon hidden for now — revisit later.
            The help sheet itself is still mounted below; this just
            drops the trigger from the top nav. */}
        {false && (
          <button className="project-header-btn" onClick={() => setShowHelp(true)} aria-label="How this page works">
            <svg viewBox="0 0 24 24" style={{ width: 17, height: 17, stroke: "currentColor", strokeWidth: 1.8, fill: "none" }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 115 0c0 1.7-2.5 2-2.5 3.5" strokeLinecap="round" />
              <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
            </svg>
          </button>
        )}
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
        <div className="studio-header-sticky" ref={headerRef}>
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

          {/* Project-level Save button — shown when layer combination changed.
              Hidden entirely in autosave mode (edits commit immediately). */}
          {!autosaveEnabled && isProjectDraftDirty(story) && (
            <button className="project-save-btn" onClick={() => setStory(s => saveProjectDraft(s))}>
              Save Project Draft {activeProjectDraft.number}
            </button>
          )}

          <div className="studio-tabs-row">
            <SectionTabs section={section} setSection={setSection} story={story} autosaveEnabled={autosaveEnabled} />
          </div>

          {/* Project drafts dropdown menu */}
          {draftsDropdownOpen && (
            <>
              <div className="drafts-dropdown-backdrop" onClick={() => setDraftsDropdownOpen(false)} />
              <div className="drafts-dropdown-menu project-draft-menu">
                {/* Mirrored header: the same project title + "Draft N ▾"
                    trigger pair that lives in the sticky studio header,
                    duplicated here so the dropdown visibly "belongs" to
                    the CTA that opened it. Tapping the cloned trigger
                    closes the menu (it's the toggle counterpart of the
                    one above). The caret is shown in the open state
                    because the menu is, by definition, open. */}
                <div className="project-draft-menu-header">
                  <div className="project-header-title">{story.title || "Untitled"}</div>
                  <button
                    className="drafts-dropdown-trigger"
                    onClick={() => setDraftsDropdownOpen(false)}
                  >
                    <span>Draft {activeProjectDraft.number}</span>
                    <img src="/caret-sm.svg" alt="" className="drafts-caret open" />
                  </button>
                </div>
                {/* Action row: New Draft (primary) + Duplicate Draft
                    (secondary), side by side. Each takes equal width so
                    the row spans the same content area as the draft list
                    items below.
                    - "New Draft" = createEmptyProjectDraft (fresh empty
                      layer drafts across all four layers; preserves the
                      project's title, format, and genres).
                    - "Duplicate Draft" = duplicateActiveProjectDraft
                      (deep-clone: new PD + fresh copies of all four
                      layer drafts, so edits don't leak back). */}
                <div className="project-draft-menu-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleCreateNewProjectDraft}
                    style={{ flex: 1 }}
                  >
                    New Draft
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDuplicateProjectDraft}
                    style={{ flex: 1 }}
                  >
                    Duplicate Draft
                  </Button>
                </div>
                {/* Divider between the action row and the draft list.
                    Pulled out as its own element (rather than a border
                    on the actions row) so the entry animation can
                    reveal it with its own timing — scaleX from center
                    after both buttons have landed. */}
                <div className="project-draft-menu-divider" aria-hidden="true" />
                {[...story.projectDrafts]
                  .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                  .map(draft => {
                    const isActive = draft.id === story.activeProjectDraftId;
                    const date = new Date(draft.updatedAt);
                    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    // Timestamp in "11:47PM" form (no space between minutes and AM/PM).
                    const timeStr = date
                      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                      .replace(" ", "");
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
                        {/* Two stacked rows: top row carries the draft name on
                            the left and its date on the far right (baseline
                            aligned). Bottom row spells out the full layer
                            combination so the user sees "Concept 1 +
                            Characters 1 + Story 1 + Script 1" instead of the
                            cryptic C/Ch/S/Sc shorthand. */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                            <span>Draft {draft.number}</span>
                            <span className="drafts-dropdown-date">{dateStr} · {timeStr}</span>
                          </div>
                          <span style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 400 }}>
                            Concept {cNum} + Characters {chNum} + Story {sNum} + Script {scNum}
                          </span>
                        </div>
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
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
            />
          )}
          {section === "characters" && (
            <CharactersTab
              story={story}
              setStory={setStory}
              run={run}
              busy={busy}
              openNewCharacter={openNewCharacterSheet}
              openCharacter={openExistingCharacterSheet}
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
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
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
            />
          )}
          {section === "script" && (
            <ScriptTab
              story={story}
              setStory={setStory}
              beats={sorted}
              run={run}
              busy={busy}
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
              onOpenReadThrough={() => setReadThroughOpen(true)}
              onImportScript={importScriptFromFile}
              importing={importing}
              importStep={importStep}
            />
          )}
        </div>
      </div>

      {/* "How this page works" help sheet — explains the layer-draft model
          for first-time users. Opened from the (?) button in the top nav. */}
      <div className={`sheet-backdrop ${showHelp ? "open" : ""}`} onClick={() => setShowHelp(false)} />
      <div className={`sheet sheet-tall ${showHelp ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">How this page works</div>
          <Button variant="secondary" size="sm" onClick={() => setShowHelp(false)}>Close</Button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal", lineHeight: 1.55 }}>
          <p style={{ marginTop: 0 }}>
            A <strong>project</strong> is one story you're working on. Inside it, your
            work is split into four <strong>sections</strong> — shown as the tabs at
            the bottom of this screen:
          </p>
          <ul style={{ paddingLeft: 18, margin: "8px 0 16px" }}>
            <li style={{ marginBottom: 6 }}>
              <strong>Concept</strong> — the premise, tone, genres, and themes. The
              one-sentence version of what this story is.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Characters</strong> — the people in it: their wants, needs,
              flaws, and how they connect.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Story</strong> — the beat outline. What happens, in order.
            </li>
            <li>
              <strong>Script</strong> — the actual screenplay pages.
            </li>
          </ul>

          <p>
            Each section has its own <strong>versions</strong>. If you rewrite your
            Concept, the old one isn't lost — it's kept as Concept v1, and your
            new take becomes v2. Same for Characters, Story, and Script. Tap the
            pill at the top of any section (e.g. <em>Concept v1</em>) to switch
            between versions or create a new one.
          </p>

          <p>
            A <strong>project version</strong> (the <em>Draft 1 ▾</em> pill at the
            top of this page) is simply a chosen combination of one Concept
            version + one Characters version + one Story version + one Script
            version. That lets you keep a "known good" snapshot of the whole
            project while you experiment with a new version of just one section.
          </p>

          <p style={{ marginBottom: 0 }}>
            <strong>Rule of thumb:</strong> work inside a section freely — the app
            tracks versions for you. When you've landed on a combination of
            sections you like together, save it as a new project version so you
            can always return to it.
          </p>
        </div>
      </div>

      {/* Streaming output sheet */}
      <div className={`sheet-backdrop ${sheetOpen ? "open" : ""}`} onClick={() => setSheetOpen(false)} />
      <div className={`sheet ${sheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">{sheetTitle}</div>
          <Button variant="secondary" size="sm" onClick={() => setSheetOpen(false)}>Close</Button>
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
          <Button variant="secondary" size="sm" onClick={() => { setPickerOpen(false); setPickerBeatId(null); }}>Close</Button>
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
          <Button variant="secondary" size="sm" onClick={() => setBeatTrayOpen(false)}>Cancel</Button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <BeatCreationForm
            story={story}
            onSave={(name, summary, characterIds) => {
              addBeat(name, summary, beatTrayInsertAt ?? undefined, characterIds);
              setBeatTrayOpen(false);
              setBeatTrayInsertAt(null);
            }}
            busy={busy}
          />
        </div>
      </div>

      {/* Character sheet — single sheet for both creation and editing.
          Sheet title reflects whether the character already has a name. */}
      {(() => {
        const open = charSheetCharId !== null;
        const activeChar = open
          ? getActiveCharactersDraft(story).characters.find(c => c.id === charSheetCharId)
          : null;
        return (
          <>
            <div className={`sheet-backdrop ${open ? "open" : ""}`}
              onClick={closeCharacterSheet} />
            <div className={`sheet sheet-tall ${open ? "open" : ""}`}>
              <div className="sheet-handle" />
              <div className="sheet-header">
                <div className="sheet-title">
                  {activeChar?.name?.trim() || "New character"}
                </div>
                <Button variant="secondary" size="sm" onClick={closeCharacterSheet}>Close</Button>
              </div>
              <div className="sheet-body" style={{ whiteSpace: "normal" }}>
                {activeChar && (
                  <CharacterEditForm
                    character={activeChar}
                    story={story}
                    onUpdate={(patch) => {
                      setStory(s => updateCharactersDraft(s, {
                        characters: getActiveCharactersDraft(s).characters.map(c =>
                          c.id === activeChar.id ? { ...c, ...patch } : c
                        ),
                      }));
                    }}
                    onRemove={() => {
                      setStory(s => updateCharactersDraft(s, {
                        characters: getActiveCharactersDraft(s).characters.filter(c => c.id !== activeChar.id),
                      }));
                      setCharSheetCharId(null);
                    }}
                  />
                )}
              </div>
              <div className="sheet-sticky-footer">
                <Button
                  variant="primary"
                  size="lg"
                  block
                  onClick={closeCharacterSheet}
                >
                  Save
                </Button>
              </div>
            </div>
          </>
        );
      })()}

      {/* Cross-layer "Update Other Layers" tray */}
      <LayerUpdateTray
        source={updateTraySource}
        story={story}
        setStory={setStory}
        setSection={setSection}
        onClose={() => setUpdateTraySource(null)}
      />

      {/* Script read-through sheet — full formatted screenplay with
          per-character voice playback. Mounted at Studio level so a
          scene's playback state survives re-renders of ScriptTab. */}
      <ReadThroughSheet
        open={readThroughOpen}
        story={story}
        onClose={() => setReadThroughOpen(false)}
      />

      {confirmDeleteDialog}

      {/* First-project welcome sheet — shown once, right after the user
          creates their very first project. Uses the same .sheet /
          .sheet-backdrop plumbing as the other bottom sheets so it feels
          native to the app. Backdrop tap and the primary button both
          dismiss + mark onboarding seen. */}
      <div
        className={`sheet-backdrop ${showWelcome ? "open" : ""}`}
        onClick={dismissWelcome}
      />
      <div className={`sheet sheet-tall ${showWelcome ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-body" style={{ whiteSpace: "normal", lineHeight: 1.55 }}>
          <div className="display heading" style={{ marginTop: 25, marginBottom: 8 }}>
            Nice job!
          </div>
          <div className="caption" style={{ marginBottom: 20 }}>
            Your first project is live. Here's what to know before you dive in.
          </div>

          <p style={{ marginTop: 0 }}>
            <strong>Make more projects.</strong> Every idea you're noodling on
            deserves its own space — separate projects keep concepts, casts,
            and scripts from bleeding into each other so you can jump between
            them without losing your place.
          </p>

          <p>
            <strong>Drafts are combinations.</strong> A project draft is just
            one Concept + one Characters + one Story + one Script version
            bundled together. Tweak a section freely — when you land on a
            combo you like, save it as a new project draft and you can
            always return to it.
          </p>

          <p style={{ marginBottom: 24 }}>
            <strong>Skip ahead with Update Other Layers.</strong> You don't
            have to fill every section yourself. Write a concept and tap
            <em> Update Other Layers</em> on that tab to auto-generate
            Characters, Story, and Script from what you have. Works from
            any layer to any other.
          </p>

          <Button
            variant="primary"
            size="lg"
            block
            onClick={dismissWelcome}
          >
            Got it
          </Button>
        </div>
      </div>

      {/* Project-created toast (same pattern as Idea Added on main page) */}
      <div className={`toast ${showSuccess ? "show" : ""}`}>Project Created</div>
    </>
  );
}

/* ============================================ */
/* ============ SECTION TABS ================== */
/* ============================================ */

function SectionTabs({
  section,
  setSection,
  story,
  autosaveEnabled = true,
}: {
  section: Section;
  setSection: (s: Section) => void;
  story: Story;
  autosaveEnabled?: boolean;
}) {
  const tabs: { key: Section; label: string; layer: LayerKey }[] = [
    { key: "concept",    label: "CONCEPT",    layer: "concept" },
    { key: "characters", label: "CHARACTERS", layer: "characters" },
    { key: "story",      label: "STORY",      layer: "story" },
    { key: "script",     label: "SCRIPT",     layer: "script" },
  ];

  return (
    <div className="studio-tab-bar">
      {tabs.map(t => {
        const dot = !autosaveEnabled && isLayerChangedForTabDot(story, t.layer);
        return (
          <button
            key={t.key}
            className={`studio-tab ${section === t.key ? "active" : ""}`}
            onClick={() => setSection(t.key)}
          >
            <span className="studio-tab-label">{t.label}</span>
            {dot && <span className="sync-dot" />}
          </button>
        );
      })}
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

// 20 curated tone presets — evocative phrasings, not one-word moods
const TONE_PRESETS: string[] = [
  "bone-dry deadpan",
  "neon-lit dread",
  "sun-bleached melancholy",
  "grim and grounded",
  "playfully unhinged",
  "slow-burn tension",
  "warm and wistful",
  "hard-boiled",
  "absurdist comedy",
  "lyrical and dreamlike",
  "nervy and kinetic",
  "quiet and observational",
  "gothic and operatic",
  "satirical",
  "retro pulp",
  "claustrophobic paranoia",
  "elegiac",
  "cold and clinical",
  "tender and human",
  "raucous and profane",
];

// 20 curated theme presets — punchy noun phrases
const THEME_PRESETS: string[] = [
  "grief",
  "inherited violence",
  "the cost of ambition",
  "identity",
  "found family",
  "moral compromise",
  "obsession",
  "class and power",
  "addiction",
  "forgiveness",
  "legacy",
  "faith and doubt",
  "memory",
  "loneliness",
  "revenge",
  "freedom and control",
  "coming of age",
  "sacrifice",
  "truth vs. myth",
  "reinvention",
];

/* ── Collapsible attribute row ── */
/* ── Layer draft picker ── */
function LayerDraftPicker({
  layer, label, story, setStory, autosaveEnabled = true,
}: {
  layer: LayerKey;
  label: string;
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  autosaveEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Mutual exclusion with the project-drafts dropdown and other
  // layer dropdowns: when this one opens, broadcast our layer id so
  // everyone else closes; when anyone else broadcasts, close this one.
  useEffect(() => {
    if (open) {
      window.dispatchEvent(
        new CustomEvent("draft-dropdown:open", { detail: layer }),
      );
    }
    const onOther = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== layer) setOpen(false);
    };
    window.addEventListener("draft-dropdown:open", onOther);
    return () => window.removeEventListener("draft-dropdown:open", onOther);
  }, [open, layer]);

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

  // Dirty = has edits since last save. Save button appears in this state.
  const isDirty = isLayerDraftDirty(active);

  const handleSave = () => {
    setStory(s => saveLayerDraft(s, layer));
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
      {!autosaveEnabled && isDirty && (
        <button className="draft-save-btn" onClick={handleSave} aria-label={`Save ${label} Draft ${active.number}`}>
          Save {label} Draft {active.number}
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

/* ============================================ */
/* =========== LAYER BAR (wrapper) ============ */
/* ============================================ */
//
// Wraps <LayerDraftPicker> plus the right-aligned "Update Other Layers"
// trigger. The trigger is only rendered when the source layer has
// content (derived via isLayerDraftEmpty). An empty source has nothing
// to derive from, so the button stays hidden rather than disabled.

function LayerBar({
  layer,
  label,
  story,
  setStory,
  autosaveEnabled = true,
  onOpenUpdateTray,
  onOpenReadThrough,
}: {
  layer: LayerKey;
  label: string;
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
  /** Script tab only: opens the full-script read-through sheet. Shown
   *  alongside the Update Other Layers trigger when the layer has
   *  source content. */
  onOpenReadThrough?: () => void;
}) {
  const hasSource = !isLayerDraftEmpty(story, layer);
  return (
    <div className="layer-bar">
      <LayerDraftPicker
        layer={layer}
        label={label}
        story={story}
        setStory={setStory}
        autosaveEnabled={autosaveEnabled}
      />
      {hasSource && onOpenReadThrough && (
        <button
          className="layer-read-trigger"
          onClick={onOpenReadThrough}
          aria-label="Read-through view"
          title="Open read-through view"
        >
          <ReadIcon />
          <span>Read-through</span>
        </button>
      )}
      {hasSource && (
        <button
          className="layer-update-trigger"
          onClick={() => onOpenUpdateTray(layer)}
          aria-label="Update other layers"
        >
          <span>Update Other Layers</span>
          <img src="/caret-sm.svg" alt="" className="drafts-caret" />
        </button>
      )}
    </div>
  );
}

function ReadIcon() {
  // Open-book glyph — keeps the trigger visually distinct from the
  // adjacent Update-Other-Layers chevron. 12px to match the caret.
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" />
      <path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
    </svg>
  );
}

/* ============================================ */
/* ========== LAYER UPDATE TRAY =============== */
/* ============================================ */
//
// Bottom sheet with three checkboxes (the layers other than the source).
// The primary "Update (N)" button commits a syncLayers() run, shows a
// per-row spinner while the matching target is in-flight, closes the
// sheet on completion, and auto-switches the app to the first checked
// target in canonical order so the user lands on the most-upstream
// result.

const ORDER_KEYS: LayerKey[] = ["concept", "characters", "story", "script"];
const LAYER_LABEL: Record<LayerKey, string> = {
  concept: "Concept",
  characters: "Characters",
  story: "Story",
  script: "Script",
};

function LayerUpdateTray({
  source,
  story,
  setStory,
  setSection,
  onClose,
}: {
  source: LayerKey | null;
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  setSection: (s: Section) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<LayerKey>>(new Set());
  const [running, setRunning] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<LayerKey | null>(null);
  const { profile } = useProfileCapture();

  // Reset selection whenever the tray opens fresh for a new source.
  useEffect(() => {
    if (source) {
      setChecked(new Set());
      setRunning(false);
      setCurrentTarget(null);
    }
  }, [source]);

  const open = source !== null;
  const targets: LayerKey[] = source
    ? ORDER_KEYS.filter(k => k !== source)
    : [];

  const toggle = (k: LayerKey) => {
    if (running) return;
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const commit = async () => {
    if (!source || checked.size === 0 || running) return;
    const ordered = ORDER_KEYS.filter(k => checked.has(k));
    const firstTarget = ordered[0];
    setRunning(true);
    try {
      const next = await syncLayers(
        story,
        source,
        ordered,
        (t) => setCurrentTarget(t),
        profile,
      );
      setStory(() => next);
      setSection(firstTarget);
      onClose();
    } catch (e: any) {
      // Preserve any partial writes that landed before the failure.
      if (e?.partialStory) setStory(() => e.partialStory);
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") {
        window.alert(`Update failed:\n\n${msg}`);
      }
      onClose();
    } finally {
      setRunning(false);
      setCurrentTarget(null);
    }
  };

  return (
    <>
      <div
        className={`sheet-backdrop ${open ? "open" : ""}`}
        onClick={running ? undefined : onClose}
      />
      <div className={`sheet layer-update-sheet ${open ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <div className="display heading" style={{ marginTop: 25, marginBottom: 8 }}>
            Update Other Layers
          </div>
          <div className="caption" style={{ marginBottom: 20 }}>
            Derive the checked layers from your current {source ? LAYER_LABEL[source] : ""} draft.
          </div>

          {targets.map(t => (
            <label key={t} className="layer-update-row">
              <input
                type="checkbox"
                checked={checked.has(t)}
                onChange={() => toggle(t)}
                disabled={running}
              />
              <span className="layer-update-row-label">{LAYER_LABEL[t]}</span>
              {running && currentTarget === t && (
                <span className="layer-update-row-spinner" aria-hidden="true" />
              )}
            </label>
          ))}

          <Button
            variant="primary"
            size="lg"
            block
            onClick={commit}
            disabled={checked.size === 0 || running}
            style={{ marginTop: 20 }}
          >
            {running ? "Updating…" : `Update (${checked.size})`}
          </Button>
        </div>
      </div>
    </>
  );
}

/* ============================================ */
/* ========== READ-THROUGH SHEET ============== */
/* ============================================ */
//
// Tall bottom-sheet that renders the full active Script draft formatted
// for reading (scene headings in caps, action paragraphs, inline
// dialogue cues), with a single "Play all" button that uses
// `speakScript` to read the whole thing with per-character voices.
// Each scene also gets its own per-scene SpeakButton so a reader can
// spot-play a single scene without queueing the whole read-through.

function ReadThroughSheet({
  open,
  story,
  onClose,
}: {
  open: boolean;
  story: Story;
  onClose: () => void;
}) {
  const scriptDraft = getActiveScriptDraft(story);
  const charactersDraft = getActiveCharactersDraft(story);
  const conceptDraft = getActiveConceptDraft(story);
  const scenes = scriptDraft.script?.scenes ?? [];
  const title = story.title || "Untitled";

  // Build one big text blob for the "Play all" button — speakScript()
  // parses headings + cues back out via scriptParse. Joining with two
  // newlines makes sure every scene starts a fresh block.
  const fullText = scenes
    .map(s => [s.heading, s.content].filter(Boolean).join("\n\n"))
    .join("\n\n");

  return (
    <>
      <div
        className={`sheet-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
      />
      <div className={`sheet sheet-tall read-through-sheet ${open ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">Read-through · {title}</div>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
        {scenes.length > 0 && (
          <div className="read-through-controls">
            <div className="caption">
              {scenes.length} scene{scenes.length === 1 ? "" : "s"}
            </div>
            <SpeakButton
              mode="script"
              size="md"
              text={fullText}
              characters={charactersDraft.characters}
              projectType={story.projectType}
              genres={conceptDraft.settings.genres}
              title="Play the whole script"
            />
          </div>
        )}
        <div className="sheet-body read-through-body">
          {scenes.length === 0 ? (
            <div className="caption" style={{ textAlign: "center", padding: "40px 20px" }}>
              No scenes in this Script draft yet.
            </div>
          ) : (
            scenes.map((sc, i) => (
              <ReadThroughScene
                key={sc.id}
                index={i}
                scene={sc}
                characters={charactersDraft.characters}
                projectType={story.projectType}
                genres={conceptDraft.settings.genres}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

function ReadThroughScene({
  index,
  scene,
  characters,
  projectType,
  genres,
}: {
  index: number;
  scene: Scene;
  characters: Character[];
  projectType: Story["projectType"];
  genres: Story["conceptDrafts"][number]["settings"]["genres"];
}) {
  const chunks = parseScreenplay(scene.content || "");
  // If the parser didn't find any structure, fall back to the raw prose
  // so the reader still sees something.
  const hasStructure = chunks.some(c => c.kind === "dialogue" || c.kind === "heading" || c.kind === "action");
  const speakText = [scene.heading, scene.content].filter(Boolean).join("\n\n");

  return (
    <div className="read-through-scene">
      <div className="read-through-scene-head">
        <div className="read-through-scene-heading">
          <span className="read-through-scene-number">{index + 1}.</span>
          <span>{scene.heading || "SCENE"}</span>
        </div>
        <SpeakButton
          mode="script"
          size="sm"
          text={speakText}
          characters={characters}
          projectType={projectType}
          genres={genres}
          title="Read this scene aloud"
        />
      </div>
      <div className="read-through-scene-body">
        {hasStructure ? (
          chunks.map((c, i) => {
            if (c.kind === "heading") return null; // already rendered above
            if (c.kind === "action") {
              return (
                <p key={i} className="read-through-action">{c.text}</p>
              );
            }
            if (c.kind === "dialogue") {
              return (
                <div key={i} className="read-through-dialogue">
                  <div className="read-through-cue">{(c.character || "").toUpperCase()}</div>
                  <div className="read-through-line">{c.text}</div>
                </div>
              );
            }
            return null;
          })
        ) : (
          <p className="read-through-action" style={{ whiteSpace: "pre-wrap" }}>
            {scene.content}
          </p>
        )}
      </div>
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
  dot,
  ai,
  aiLoading,
}: {
  label: string;
  values?: string[];
  placeholder?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  dot?: boolean;
  ai?: () => void;
  aiLoading?: boolean;
}) {
  const hasValues = values && values.length > 0;
  return (
    <div className="attr-row">
      <button className="attr-row-header" onClick={onToggle}>
        <span className="attr-label">
          {label}
          {ai && <AIWandButton onClick={ai} loading={!!aiLoading} />}
          {dot && <span className="sync-dot attr-dot" />}
        </span>
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

/* ── AI history: ring-buffered per-field generation history (max 10) ── */
// Persisted to localStorage so navigation survives reloads and tab switches.
const AI_HISTORY_MAX = 10;

function useAIHistory(key: string | null) {
  // key === null means "no persistence for this field" — hook becomes a no-op
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number>(-1);

  // Load from storage when the key changes (switch character, switch draft, etc.)
  useEffect(() => {
    if (!key || typeof window === "undefined") {
      setHistory([]); setCursor(-1);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.history)) {
        setHistory(parsed.history);
        setCursor(typeof parsed.cursor === "number" ? parsed.cursor : parsed.history.length - 1);
      } else {
        setHistory([]); setCursor(-1);
      }
    } catch { setHistory([]); setCursor(-1); }
  }, [key]);

  // Persist on change
  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    try {
      localStorage.setItem(key, JSON.stringify({ history, cursor }));
    } catch {}
  }, [key, history, cursor]);

  const push = useCallback((val: string) => {
    setHistory(prev => {
      const next = [...prev, val];
      while (next.length > AI_HISTORY_MAX) next.shift();
      setCursor(next.length - 1);
      return next;
    });
  }, []);

  const stepBack = useCallback(() => {
    if (cursor <= 0) return null;
    const nc = cursor - 1;
    setCursor(nc);
    return history[nc] ?? null;
  }, [cursor, history]);

  const stepForward = useCallback(() => {
    if (cursor < 0 || cursor >= history.length - 1) return null;
    const nc = cursor + 1;
    setCursor(nc);
    return history[nc] ?? null;
  }, [cursor, history]);

  return {
    history, cursor, push, stepBack, stepForward,
    canBack: cursor > 0,
    canForward: cursor >= 0 && cursor < history.length - 1,
  };
}

/* ── History pager: elegant pill with < 3/5 > ── */
function HistoryPager({
  history, cursor, onBack, onForward, canBack, canForward,
}: {
  history: string[];
  cursor: number;
  onBack: () => void;
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
}) {
  if (history.length === 0) return null;
  return (
    <span className="ai-pager" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className="ai-pager-btn"
        disabled={!canBack}
        onClick={e => { e.stopPropagation(); onBack(); }}
        aria-label="Previous AI result"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="ai-pager-count">{cursor + 1}</span>
      <button
        type="button"
        className="ai-pager-btn"
        disabled={!canForward}
        onClick={e => { e.stopPropagation(); onForward(); }}
        aria-label="Next AI result"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </span>
  );
}

/* ── AI wand button — elegant sparkle, sits next to field labels ── */
function AIWandButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      className={`ai-wand ${loading ? "loading" : ""}`}
      onClick={e => { e.stopPropagation(); if (!loading) onClick(); }}
      aria-label="Generate with AI"
      disabled={loading}
    >
      {loading ? (
        <svg viewBox="0 0 24 24" width="14" height="14" className="ai-wand-spin" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      ) : (
        // Lightning-bolt glyph from Noun Project (Damar Creative).
        <svg viewBox="0 0 100 110" width="12" height="12" fill="currentColor" aria-hidden="true">
          <path d="m41.785 60.52h-13.055c-0.52344-0.0078-1.0547-0.14844-1.5352-0.43359-1.4141-0.84766-1.8789-2.6836-1.0273-4.1016l31.906-53.211c0.60547-1.0117 1.7852-1.6094 3.0195-1.4141 1.6289 0.25391 2.7461 1.7773 2.4961 3.4102l-5.375 34.715h13.055c0.52344 0.0078 1.0547 0.14844 1.5352 0.43359 1.4141 0.84766 1.8789 2.6836 1.0273 4.1016l-31.906 53.211c-0.60547 1.0117-1.7852 1.6094-3.0195 1.4141-1.6289-0.25391-2.7461-1.7773-2.4961-3.4102z" />
        </svg>
      )}
    </button>
  );
}

/* ── Text attribute row — stays open once filled, input loses chrome when unfocused ── */
function TextAttrRow({
  label,
  value,
  placeholder,
  onChange,
  multiline,
  dot,
  ai,
  aiLoading,
  pager,
  speak,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  dot?: boolean;
  ai?: () => void;
  aiLoading?: boolean;
  pager?: React.ReactNode;
  /** Optional slot rendered next to the AI wand (used for the read-aloud button). */
  speak?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hasValue = value.trim().length > 0;
  const isOpen = hasValue || focused;

  // Auto-resize textarea to fit content (full text visible, no cutoff)
  useEffect(() => {
    if (multiline && taRef.current) {
      taRef.current.style.height = "auto";
      taRef.current.style.height = taRef.current.scrollHeight + "px";
    }
  }, [value, focused, multiline]);

  if (!isOpen) {
    return (
      <div className="attr-row">
        <button className="attr-row-header" onClick={() => setFocused(true)}>
          <span className="attr-label">
            {label}
            {ai && <AIWandButton onClick={ai} loading={!!aiLoading} />}
            {speak}
            {dot && <span className="sync-dot attr-dot" />}
          </span>
          <div className="attr-values">
            <span className="attr-placeholder">{placeholder}</span>
          </div>
          {pager}
          <svg className="attr-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    );
  }

  const inputClass = `attr-text-input ${!focused && hasValue ? "unfocused-filled" : ""}`;

  return (
    <div className="attr-row attr-row-text-open">
      <div className="attr-row-header attr-row-header-static">
        <span className="attr-label">
          {label}
          {ai && <AIWandButton onClick={ai} loading={!!aiLoading} />}
          {dot && <span className="sync-dot attr-dot" />}
        </span>
        {pager}
      </div>
      <div className="attr-row-body">
        {multiline ? (
          <textarea
            ref={taRef}
            className={inputClass}
            value={value}
            onChange={e => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={focused ? placeholder : ""}
            rows={1}
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

function ConceptTab({
  story,
  setStory,
  autosaveEnabled = true,
  onOpenUpdateTray,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
}) {
  const d = getActiveConceptDraft(story);
  const [openAttr, setOpenAttr] = useState<string | null>(null);
  const [themeInput, setThemeInput] = useState("");
  const [toneInput, setToneInput] = useState("");
  const [toneCustomOpen, setToneCustomOpen] = useState(false);
  const [themeCustomOpen, setThemeCustomOpen] = useState(false);
  const [referenceInput, setReferenceInput] = useState("");
  const [writerSheetOpen, setWriterSheetOpen] = useState(false);
  const [writerFilter, setWriterFilter] = useState("");
  // Writer-profile capture — every chip toggle and saved prose sample
  // feeds the cumulative per-user taste/voice model. See lib/writerProfile.ts.
  const { profile, capture, captureStyle } = useProfileCapture();

  // Track which AI generator is currently running (one at a time)
  const [aiBusy, setAiBusy] = useState<null | "title" | "logline" | "summary" | "tone" | "themes" | "ending">(null);

  // Per-field AI generation history (pagination) — only for text inputs.
  // Tone/Themes/Ending are chip selectors and do not participate.
  const titleHistory   = useAIHistory(`scriptlab.aihist.concept.${story.id}.${d.id}.title`);
  const loglineHistory = useAIHistory(`scriptlab.aihist.concept.${story.id}.${d.id}.logline`);
  const summaryHistory = useAIHistory(`scriptlab.aihist.concept.${story.id}.${d.id}.summary`);

  const toggle = (key: string) => setOpenAttr(prev => prev === key ? null : key);
  const updateDraft = (patch: Partial<ConceptLayerDraft>) => setStory(s => updateConceptDraft(s, patch));

  // ── "Similar To" reference helpers ──
  function addReference() {
    const title = referenceInput.trim();
    if (!title) return;
    // Dedupe by case-insensitive title so the user can't stack "Se7en" / "SE7EN".
    if (d.settings.references.some(r => r.title.toLowerCase() === title.toLowerCase())) {
      setReferenceInput("");
      return;
    }
    const newRef: Reference = {
      id: "ref_" + Math.random().toString(36).slice(2, 10),
      title,
      aspects: [],
    };
    updateDraft({ settings: { ...d.settings, references: [...d.settings.references, newRef] } });
    capture("referenceTitles", title);
    setReferenceInput("");
  }
  function removeReference(id: string) {
    updateDraft({
      settings: { ...d.settings, references: d.settings.references.filter(r => r.id !== id) },
    });
  }
  function toggleReferenceAspect(id: string, aspect: string) {
    const ref = d.settings.references.find(r => r.id === id);
    const adding = ref ? !ref.aspects.includes(aspect) : false;
    updateDraft({
      settings: {
        ...d.settings,
        references: d.settings.references.map(r =>
          r.id !== id
            ? r
            : { ...r, aspects: r.aspects.includes(aspect) ? r.aspects.filter(a => a !== aspect) : [...r.aspects, aspect] }
        ),
      },
    });
    // Only count adds as preference signal; removals don't tell us what they want.
    if (adding) capture("referenceAspects", aspect);
  }

  // ── Writer-style helpers ──
  function toggleWriter(name: string) {
    const current = d.settings.writerStyles;
    const adding = !current.includes(name);
    updateDraft({
      settings: {
        ...d.settings,
        writerStyles: adding ? [...current, name] : current.filter(w => w !== name),
      },
    });
    if (adding) capture("writerStyles", name);
  }
  const filteredWriters = WRITER_STYLES.filter(w =>
    w.toLowerCase().includes(writerFilter.trim().toLowerCase())
  );

  function addTheme(raw?: string) {
    const t = (raw ?? themeInput).trim();
    if (!t) return;
    if (d.concept.themes.includes(t)) return;
    updateDraft({ concept: { ...d.concept, themes: [...d.concept.themes, t] } });
    capture("themes", t);
    setThemeInput("");
  }

  function removeTheme(theme: string) {
    updateDraft({ concept: { ...d.concept, themes: d.concept.themes.filter(t => t !== theme) } });
  }

  function setTone(t: string) {
    updateDraft({ concept: { ...d.concept, tone: t } });
    if (t) capture("tones", t);
  }

  // ── AI generator: POST to /api/generate with current story+action, parse JSON result, apply ──
  async function generateConcept(field: "title" | "logline" | "summary" | "tone" | "themes" | "ending") {
    if (aiBusy) return;
    setAiBusy(field);
    try {
      const type =
        field === "title"   ? "generate_concept_title" :
        field === "logline" ? "generate_concept_logline" :
        field === "summary" ? "generate_concept_summary" :
        field === "tone"    ? "generate_concept_tone" :
        field === "themes"  ? "generate_concept_themes" :
                              "generate_concept_ending";
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, action: { type, payload: {} }, profile }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "text") fullText += evt.value;
          } catch {}
        }
      }
      // Extract JSON from response (model may wrap in code fence or add prose)
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      const parsed = JSON.parse(jsonMatch[0]);
      // Apply to draft based on field (and push to history for text fields)
      setStory(s => {
        if (field === "title") {
          const v = String(parsed.title ?? "");
          if (v) titleHistory.push(v);
          return updateConceptDraft({ ...s, title: v }, {});
        }
        if (field === "logline") {
          const v = String(parsed.logline ?? "");
          if (v) loglineHistory.push(v);
          return updateConceptDraft(s, { logline: v });
        }
        if (field === "summary") {
          const v = String(parsed.summary ?? "");
          if (v) summaryHistory.push(v);
          const c = getActiveConceptDraft(s);
          return updateConceptDraft(s, { concept: { ...c.concept, summary: v } });
        }
        if (field === "tone") {
          const c = getActiveConceptDraft(s);
          return updateConceptDraft(s, { concept: { ...c.concept, tone: String(parsed.tone ?? "") } });
        }
        if (field === "themes") {
          const c = getActiveConceptDraft(s);
          const incoming: string[] = Array.isArray(parsed.themes) ? parsed.themes.map((x: any) => String(x)) : [];
          const merged = Array.from(new Set([...c.concept.themes, ...incoming]));
          return updateConceptDraft(s, { concept: { ...c.concept, themes: merged } });
        }
        if (field === "ending") {
          const c = getActiveConceptDraft(s);
          const val = String(parsed.ending ?? "").toLowerCase();
          const allowed = ["happy","bittersweet","tragic","ambiguous","twist"];
          if (!allowed.includes(val)) return s;
          const existing = c.settings.endingTypes;
          const endingTypes = existing.includes(val as any) ? existing : [...existing, val as any];
          return updateConceptDraft(s, { settings: { ...c.settings, endingTypes } });
        }
        return s;
      });
    } catch (err) {
      console.error("Concept generation failed:", err);
    } finally {
      setAiBusy(null);
    }
  }

  const formatLabel = story.projectType === "tv-show" ? "TV Show" : story.projectType === "short" ? "Short Film" : "Feature Film";

  return (
    <>
      <LayerBar layer="concept" label="Concept" story={story} setStory={setStory} autosaveEnabled={autosaveEnabled} onOpenUpdateTray={onOpenUpdateTray} />

      {/* Format */}
      <AttrRow
        label="Format"
        values={[formatLabel.toUpperCase()]}
        expanded={openAttr === "format"}
        onToggle={() => toggle("format")}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "projectType")}
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
              onClick={() => {
                setStory(s => updateConceptDraft({ ...s, projectType: pt.value }, {}));
                capture("projectTypes", pt.value);
              }}
              style={{ textAlign: "left", padding: "12px 17px" }}
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
        dot={!autosaveEnabled && isConceptFieldDirty(story, "genres")}
      >
        <div className="chip-row">
          {(["thriller","drama","comedy","sci-fi","horror","romance","action","mystery"] as const).map(g => (
            <Selector key={g}
              selected={d.settings.genres.includes(g)}
              onClick={() => {
                const isRemoving = d.settings.genres.includes(g);
                const nextGenres = isRemoving
                  ? d.settings.genres.filter(x => x !== g)
                  : [...d.settings.genres, g];
                // When a parent genre is removed, prune its sub-genre
                // selections so we don't keep orphaned ids the user can no
                // longer see in the picker.
                const orphanPrefix = `${g}:`;
                const nextSubGenres = isRemoving
                  ? d.settings.subGenres.filter(id => !id.startsWith(orphanPrefix))
                  : d.settings.subGenres;
                updateDraft({
                  settings: { ...d.settings, genres: nextGenres, subGenres: nextSubGenres },
                });
                if (!isRemoving) capture("genres", g);
              }}>
              {g}
            </Selector>
          ))}
        </div>
      </AttrRow>

      {/* Sub-Genre — options are derived from the selected parent genres.
          Each option shows the sub-genre name plus three canonical film
          examples underneath so the user can recognize it at a glance. */}
      {(() => {
        const subOptions = subGenresFor(d.settings.genres);
        const selectedNames = d.settings.subGenres
          .map(id => SUB_GENRES_BY_ID[id]?.name)
          .filter(Boolean) as string[];
        return (
          <AttrRow
            label="Sub-Genre"
            values={selectedNames.length > 0 ? selectedNames.map(n => n.toUpperCase()) : undefined}
            placeholder={d.settings.genres.length === 0 ? "Select a genre first" : "Select sub-genres"}
            expanded={openAttr === "subgenre"}
            onToggle={() => toggle("subgenre")}
          >
            {d.settings.genres.length === 0 ? (
              <div className="caption" style={{ padding: "4px 0" }}>
                Pick at least one genre above to see matching sub-genres.
              </div>
            ) : (
              <div className="subgenre-list">
                {subOptions.map(opt => {
                  const selected = d.settings.subGenres.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`subgenre-option ${selected ? "selected" : ""}`}
                      onClick={() => {
                        updateDraft({
                          settings: {
                            ...d.settings,
                            subGenres: selected
                              ? d.settings.subGenres.filter(x => x !== opt.id)
                              : [...d.settings.subGenres, opt.id],
                          },
                        });
                        if (!selected) capture("subGenres", opt.name);
                      }}
                      aria-pressed={selected}
                    >
                      <span className="subgenre-option-name">{opt.name}</span>
                      <span className="subgenre-option-examples">{opt.examples.join(", ")}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </AttrRow>
        );
      })()}

      {/* Similar To — free-form references (films / shows) each tagged
          with which craft aspects the user wants to mirror. */}
      <AttrRow
        label="Similar To"
        values={d.settings.references.length > 0 ? d.settings.references.map(r => r.title.toUpperCase()) : undefined}
        placeholder="Add films or shows"
        expanded={openAttr === "references"}
        onToggle={() => toggle("references")}
      >
        <div className="reference-list">
          {d.settings.references.map(ref => (
            <div key={ref.id} className="reference-card">
              <div className="reference-card-head">
                <span className="reference-card-title">{ref.title}</span>
                <button
                  type="button"
                  className="reference-card-remove"
                  aria-label={`Remove ${ref.title}`}
                  onClick={() => removeReference(ref.id)}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="6" y1="18" x2="18" y2="6" />
                  </svg>
                </button>
              </div>
              <div className="reference-card-caption">What do you want to mimic?</div>
              <div className="aspect-chip-row">
                {REFERENCE_ASPECTS.map(aspect => (
                  <button
                    key={aspect}
                    type="button"
                    className={`aspect-chip ${ref.aspects.includes(aspect) ? "is-selected" : ""}`}
                    onClick={() => toggleReferenceAspect(ref.id, aspect)}
                    aria-pressed={ref.aspects.includes(aspect)}
                  >
                    {aspect}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="reference-add-row">
            <input
              className="attr-text-input"
              placeholder="e.g. Breaking Bad, Uncut Gems"
              value={referenceInput}
              onChange={e => setReferenceInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addReference(); } }}
              style={{ flex: 1 }}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={addReference}
              disabled={!referenceInput.trim()}
            >
              Add
            </Button>
          </div>
        </div>
      </AttrRow>

      {/* Writer Style — roster of famous screenwriters, multi-select via
          a fly-up sheet with a search filter. Rendered as a non-collapsing
          row: selected writers show inline as pills next to the label, and
          the Select/Edit button is always exposed below (no caret, no
          duplicate chip list). */}
      <div className="attr-row">
        <div className="attr-row-header attr-row-header-static">
          <span className="attr-label">Writer Style</span>
          <div className="attr-values">
            {d.settings.writerStyles.length > 0
              ? d.settings.writerStyles.map(w => (
                  <span key={w} className="attr-pill">{w.toUpperCase()}</span>
                ))
              : <span className="attr-placeholder">Pick writers you want to echo</span>}
          </div>
        </div>
        <div className="attr-row-body" style={{ paddingTop: 16 }}>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => { setWriterFilter(""); setWriterSheetOpen(true); }}
          >
            {d.settings.writerStyles.length > 0 ? "Edit writers" : "Select writers"}
          </Button>
        </div>
      </div>

      {/* Title */}
      <TextAttrRow
        label="Title"
        value={story.title}
        placeholder="Add a title"
        onChange={v => setStory(s => updateConceptDraft({ ...s, title: v }, {}))}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "title")}
        ai={() => generateConcept("title")}
        aiLoading={aiBusy === "title"}
        pager={
          <HistoryPager
            history={titleHistory.history}
            cursor={titleHistory.cursor}
            canBack={titleHistory.canBack}
            canForward={titleHistory.canForward}
            onBack={() => {
              const v = titleHistory.stepBack();
              if (v !== null) setStory(s => updateConceptDraft({ ...s, title: v }, {}));
            }}
            onForward={() => {
              const v = titleHistory.stepForward();
              if (v !== null) setStory(s => updateConceptDraft({ ...s, title: v }, {}));
            }}
          />
        }
      />

      {/* Logline */}
      <TextAttrRow
        label="Logline"
        value={d.logline}
        placeholder="Add a logline"
        onChange={v => updateDraft({ logline: v })}
        multiline
        dot={!autosaveEnabled && isConceptFieldDirty(story, "logline")}
        ai={() => generateConcept("logline")}
        aiLoading={aiBusy === "logline"}
        speak={
          d.logline?.trim() ? (
            <SpeakButton
              text={d.logline}
              projectType={story.projectType}
              genres={d.settings.genres}
            />
          ) : null
        }
        pager={
          <HistoryPager
            history={loglineHistory.history}
            cursor={loglineHistory.cursor}
            canBack={loglineHistory.canBack}
            canForward={loglineHistory.canForward}
            onBack={() => {
              const v = loglineHistory.stepBack();
              if (v !== null) updateDraft({ logline: v });
            }}
            onForward={() => {
              const v = loglineHistory.stepForward();
              if (v !== null) updateDraft({ logline: v });
            }}
          />
        }
      />

      {/* Summary */}
      <TextAttrRow
        label="Summary"
        value={d.concept.summary}
        placeholder="Add a premise"
        onChange={v => updateDraft({ concept: { ...d.concept, summary: v } })}
        multiline
        dot={!autosaveEnabled && isConceptFieldDirty(story, "summary")}
        ai={() => generateConcept("summary")}
        aiLoading={aiBusy === "summary"}
        pager={
          <HistoryPager
            history={summaryHistory.history}
            cursor={summaryHistory.cursor}
            canBack={summaryHistory.canBack}
            canForward={summaryHistory.canForward}
            onBack={() => {
              const v = summaryHistory.stepBack();
              if (v !== null) updateDraft({ concept: { ...d.concept, summary: v } });
            }}
            onForward={() => {
              const v = summaryHistory.stepForward();
              if (v !== null) updateDraft({ concept: { ...d.concept, summary: v } });
            }}
          />
        }
      />

      {/* Tone — 20 presets + custom input */}
      <AttrRow
        label="Tone"
        values={d.concept.tone ? [d.concept.tone] : undefined}
        placeholder="Set the tone"
        expanded={openAttr === "tone"}
        onToggle={() => toggle("tone")}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "tone")}
        ai={() => generateConcept("tone")}
        aiLoading={aiBusy === "tone"}
      >
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {TONE_PRESETS.map(t => (
            <Selector key={t}
              selected={d.concept.tone === t}
              onClick={() => setTone(d.concept.tone === t ? "" : t)}>
              {t}
            </Selector>
          ))}
          <button
            className={`chip chip-custom ${toneCustomOpen ? "selected" : ""}`}
            onClick={() => setToneCustomOpen(o => !o)}>
            + Custom
          </button>
        </div>
        {toneCustomOpen && (
          <div style={{ display: "flex", gap: 8 }}>
            <Input
              value={toneInput}
              onChange={e => setToneInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && toneInput.trim()) {
                  setTone(toneInput.trim());
                  setToneInput("");
                  setToneCustomOpen(false);
                }
              }}
              placeholder="Describe the tone"
              style={{ flex: 1, marginBottom: 0 }}
              autoFocus
            />
            <Button variant="secondary" size="sm"
              onClick={() => {
                if (!toneInput.trim()) return;
                setTone(toneInput.trim());
                setToneInput("");
                setToneCustomOpen(false);
              }}
              disabled={!toneInput.trim()}
              style={{ flexShrink: 0 }}>
              Set
            </Button>
          </div>
        )}
      </AttrRow>

      {/* Themes — 20 presets + custom input */}
      <AttrRow
        label="Themes"
        values={d.concept.themes.length > 0 ? d.concept.themes : undefined}
        placeholder="Add themes"
        expanded={openAttr === "themes"}
        onToggle={() => toggle("themes")}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "themes")}
        ai={() => generateConcept("themes")}
        aiLoading={aiBusy === "themes"}
      >
        {d.concept.themes.length > 0 && (
          <div className="chip-row" style={{ marginBottom: 10 }}>
            {d.concept.themes.map(t => (
              <Selector key={t} selected onClick={() => removeTheme(t)}>
                {t} &#10005;
              </Selector>
            ))}
          </div>
        )}
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {THEME_PRESETS.filter(t => !d.concept.themes.includes(t)).map(t => (
            <Selector key={t}
              onClick={() => addTheme(t)}>
              {t}
            </Selector>
          ))}
          <button
            className={`chip chip-custom ${themeCustomOpen ? "selected" : ""}`}
            onClick={() => setThemeCustomOpen(o => !o)}>
            + Custom
          </button>
        </div>
        {themeCustomOpen && (
          <div style={{ display: "flex", gap: 8 }}>
            <Input
              value={themeInput}
              onChange={e => setThemeInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && themeInput.trim()) {
                  addTheme();
                  setThemeCustomOpen(false);
                }
              }}
              placeholder="Add a theme"
              style={{ flex: 1, marginBottom: 0 }}
              autoFocus
            />
            <Button variant="secondary" size="sm"
              onClick={() => { addTheme(); setThemeCustomOpen(false); }}
              disabled={!themeInput.trim()}
              style={{ flexShrink: 0 }}>
              Add
            </Button>
          </div>
        )}
      </AttrRow>

      {/* Structure — beat-skeleton framework the AI uses when generating
          beats and syncing Story from other layers. Optional: if unset,
          prompts tell the model to pick whatever fits the concept.
          Rendered with the same .choice button treatment as Format, but
          each option includes a 1–2 sentence description under the title
          so newcomers can recognize what they're picking. */}
      <AttrRow
        label="Structure"
        values={d.settings.framework
          ? [d.settings.framework.replace(/-/g, " ").toUpperCase()]
          : undefined}
        placeholder="Pick a structure"
        expanded={openAttr === "structure"}
        onToggle={() => toggle("structure")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {([
            {
              value: "save-the-cat" as const,
              label: "Save the Cat",
              description: "Blake Snyder's 15-beat feature template. Fixed landmarks — Catalyst, Midpoint, All Is Lost, Finale — mapped to page counts. Most common in studio film.",
            },
            {
              value: "heros-journey" as const,
              label: "Hero's Journey",
              description: "Campbell and Vogler's 12-stage myth arc. Ordinary World → Call → Ordeal → Return with the elixir. Fits adventure, fantasy, and coming-of-age journeys.",
            },
            {
              value: "three-act" as const,
              label: "Three-Act",
              description: "The classical Setup → Confrontation → Resolution scaffold. Minimal prescription — just three pivots. Works for any genre when other structures feel over-engineered.",
            },
            {
              value: "story-circle" as const,
              label: "Story Circle",
              description: "Dan Harmon's 8-step circle: You → Need → Go → Search → Find → Take → Return → Change. Tight, character-focused, ideal for TV episodes and shorts.",
            },
          ]).map(f => (
            <button
              key={f.value}
              className={`choice ${d.settings.framework === f.value ? "selected" : ""}`}
              onClick={() => {
                // Tap-to-toggle: tapping the already-selected structure
                // clears it. Matches the behavior of single-select chips
                // elsewhere in the Concept tab.
                const next = d.settings.framework === f.value ? null : f.value;
                updateDraft({ settings: { ...d.settings, framework: next } });
              }}
              style={{ textAlign: "left", padding: "12px 17px" }}
            >
              <div className="choice-title">{f.label}</div>
              <div className="choice-sub">{f.description}</div>
            </button>
          ))}
        </div>
      </AttrRow>

      {/* Ending */}
      <AttrRow
        label="Ending"
        values={d.settings.endingTypes.length > 0 ? d.settings.endingTypes.map(e => e.toUpperCase()) : undefined}
        placeholder="Select ending type"
        expanded={openAttr === "ending"}
        onToggle={() => toggle("ending")}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "endingTypes")}
        ai={() => generateConcept("ending")}
        aiLoading={aiBusy === "ending"}
      >
        <div className="chip-row">
          {(["happy","bittersweet","tragic","ambiguous","twist"] as const).map(e => (
            <Selector key={e}
              selected={d.settings.endingTypes.includes(e)}
              onClick={() => {
                const isAdding = !d.settings.endingTypes.includes(e);
                updateDraft({
                  settings: {
                    ...d.settings,
                    endingTypes: isAdding
                      ? [...d.settings.endingTypes, e]
                      : d.settings.endingTypes.filter(x => x !== e),
                  },
                });
                if (isAdding) capture("endingTypes", e);
              }}>
              {e}
            </Selector>
          ))}
        </div>
      </AttrRow>

      {/* Writer-style picker — fly-up sheet with a filterable roster of
          famous screenwriters. Multi-select; the ConceptTab's chip row
          above reflects the current selection in real time. */}
      <div
        className={`sheet-backdrop ${writerSheetOpen ? "open" : ""}`}
        onClick={() => setWriterSheetOpen(false)}
      />
      <div className={`sheet sheet-tall ${writerSheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">Writer style</div>
          <Button variant="secondary" size="sm" onClick={() => setWriterSheetOpen(false)}>Done</Button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal", paddingTop: 0 }}>
          <input
            className="attr-text-input writer-filter-input"
            placeholder="Filter writers…"
            value={writerFilter}
            onChange={e => setWriterFilter(e.target.value)}
            autoFocus={false}
          />
          {filteredWriters.length === 0 ? (
            <div className="caption" style={{ padding: "12px 0" }}>No writers match “{writerFilter}”.</div>
          ) : (
            <div className="chip-row writer-chip-row">
              {filteredWriters.map(w => (
                <Selector
                  key={w}
                  selected={d.settings.writerStyles.includes(w)}
                  onClick={() => toggleWriter(w)}
                >
                  {w}
                </Selector>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================================ */
/* ============ CHARACTERS TAB ================ */
/* ============================================ */

// 20 curated character archetypes — cross-genre, instantly legible
const ARCHETYPE_PRESETS: string[] = [
  "reluctant hero",
  "mentor",
  "trickster",
  "wise fool",
  "tragic villain",
  "anti-hero",
  "femme fatale",
  "everyman",
  "rebel",
  "caretaker",
  "outlaw",
  "innocent",
  "magician",
  "ruler",
  "seeker",
  "shadow",
  "sidekick",
  "unreliable narrator",
  "fallen idol",
  "chosen one",
];

// Which character fields support AI generation (all except role)
type CharAIField =
  | "name" | "archetype" | "backstory" | "motivations"
  | "flaws" | "want" | "need" | "voice" | "arc" | "notes";

const CHAR_AI_ACTION: Record<CharAIField, string> = {
  name:        "generate_character_name",
  archetype:   "generate_character_archetype",
  backstory:   "generate_character_backstory",
  motivations: "generate_character_motivations",
  flaws:       "generate_character_flaws",
  want:        "generate_character_want",
  need:        "generate_character_need",
  voice:       "generate_character_voice",
  arc:         "generate_character_arc",
  notes:       "generate_character_notes",
};

/* ── Character field wrapper: input/textarea with an inline AI wand ── */
function CharField({
  label, value, onChange, onAI, aiBusy, multiline, rows, pager,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onAI: () => void;
  aiBusy: boolean;
  multiline?: boolean;
  rows?: number;
  pager?: React.ReactNode;
}) {
  // Reserve extra right-side padding when a pager is present so
  // the cluster (pager + wand) doesn't cover input text.
  const reservedClass = pager ? "char-field-has-pager" : "";
  return (
    <div className={`char-field ${multiline ? "char-field-multiline" : ""} ${reservedClass}`}>
      {multiline ? (
        <Textarea
          placeholder={label}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows ?? 2}
        />
      ) : (
        <Input
          placeholder={label}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
      <div className="char-field-ai">
        <AIWandButton onClick={onAI} loading={aiBusy} />
        {pager}
      </div>
    </div>
  );
}

function CharactersTab({
  story,
  setStory,
  run,
  busy,
  openNewCharacter,
  openCharacter,
  autosaveEnabled = true,
  onOpenUpdateTray,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
  openNewCharacter: () => void;
  openCharacter: (id: string) => void;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
}) {
  const d = getActiveCharactersDraft(story);

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
      <LayerBar layer="characters" label="Characters" story={story} setStory={setStory} autosaveEnabled={autosaveEnabled} onOpenUpdateTray={onOpenUpdateTray} />

      {/* Primary "+ Add character" lives at the top of the list. */}
      <Button
        variant="primary"
        size="lg"
        block
        onClick={openNewCharacter}
        style={{ marginBottom: 12 }}
        icon={<span style={{ fontSize: 14, lineHeight: 1 }}>+</span>}
        className="entity-create-btn"
      >
        Add character
      </Button>

      {d.characters.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>👤</div>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>No characters yet</div>
          <div className="caption">
            Create your first character to bring your story to life.
          </div>
        </div>
      )}

      {/* Character rows — tapping opens the unified character sheet. */}
      {d.characters.map(ch => (
        <div key={ch.id} className="card character-card">
          <button
            className="character-header"
            onClick={() => openCharacter(ch.id)}
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
            <span className="beat-expand">›</span>
          </button>
        </div>
      ))}

      {/* Info banner */}
      <div className="info-banner" style={{ marginTop: 16 }}>
        <span className="info-icon">i</span>
        <span>Characters inform AI-generated beats, scenes, and dialogue.</span>
      </div>
    </>
  );
}

/* ── Character edit form ── */

function CharacterEditForm({
  character: ch,
  story,
  onUpdate,
  onRemove,
}: {
  character: Character;
  story: Story;
  onUpdate: (patch: Partial<Character>) => void;
  onRemove: () => void;
}) {
  const roles: { key: string; label: string }[] = [
    { key: "protagonist",   label: "Protagonist" },
    { key: "antagonist",    label: "Antagonist" },
    { key: "supporting",    label: "Supporting" },
    { key: "mentor",        label: "Mentor" },
    { key: "love_interest", label: "Love Interest" },
    { key: "comic_relief",  label: "Comic Relief" },
  ];
  const [archetypeCustomOpen, setArchetypeCustomOpen] = useState(false);
  const [archetypeInput, setArchetypeInput] = useState("");
  const [aiBusy, setAiBusy] = useState<CharAIField | null>(null);
  // Writer profile — attached to every character-field AI call so the
  // generated trait biases toward the user's recorded voice/preferences.
  const { profile } = useProfileCapture();

  // Per-field AI generation history. Scoped by story + character id so it
  // follows the character across draft switches and persists across reloads.
  // Archetype is a chip picker and is excluded.
  const histKey = (f: string) => `scriptlab.aihist.char.${story.id}.${ch.id}.${f}`;
  const nameHist        = useAIHistory(histKey("name"));
  const backstoryHist   = useAIHistory(histKey("backstory"));
  const motivationsHist = useAIHistory(histKey("motivations"));
  const flawsHist       = useAIHistory(histKey("flaws"));
  const wantHist        = useAIHistory(histKey("want"));
  const needHist        = useAIHistory(histKey("need"));
  const voiceHist       = useAIHistory(histKey("voice"));
  const arcHist         = useAIHistory(histKey("arc"));
  const notesHist       = useAIHistory(histKey("notes"));

  const histFor: Partial<Record<CharAIField, ReturnType<typeof useAIHistory>>> = {
    name: nameHist,
    backstory: backstoryHist,
    motivations: motivationsHist,
    flaws: flawsHist,
    want: wantHist,
    need: needHist,
    voice: voiceHist,
    arc: arcHist,
    notes: notesHist,
  };

  async function generateCharacterField(field: CharAIField) {
    if (aiBusy) return;
    setAiBusy(field);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story,
          action: { type: CHAR_AI_ACTION[field], payload: { characterId: ch.id } },
          profile,
        }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "text") fullText += evt.value;
          } catch {}
        }
      }
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      const parsed = JSON.parse(jsonMatch[0]);
      const val = parsed[field];
      if (typeof val === "string" && val.trim()) {
        onUpdate({ [field]: val } as Partial<Character>);
        // Push to history if this field has a pager (excludes archetype)
        const hist = histFor[field];
        if (hist) hist.push(val);
      }
    } catch (err) {
      console.error("Character generation failed:", err);
    } finally {
      setAiBusy(null);
    }
  }

  // Small helper to build a pager node for a given character field
  function pagerFor(field: CharAIField) {
    const h = histFor[field];
    if (!h) return undefined;
    return (
      <HistoryPager
        history={h.history}
        cursor={h.cursor}
        canBack={h.canBack}
        canForward={h.canForward}
        onBack={() => {
          const v = h.stepBack();
          if (v !== null) onUpdate({ [field]: v } as Partial<Character>);
        }}
        onForward={() => {
          const v = h.stepForward();
          if (v !== null) onUpdate({ [field]: v } as Partial<Character>);
        }}
      />
    );
  }

  function selectArchetype(a: string) {
    onUpdate({ archetype: ch.archetype === a ? "" : a });
  }

  return (
    <div className="stack">
      <CharField
        label="Name"
        value={ch.name}
        onChange={v => onUpdate({ name: v })}
        onAI={() => generateCharacterField("name")}
        aiBusy={aiBusy === "name"}
        pager={pagerFor("name")}
      />

      {/* Role — chip selector matching Concept tab (Genre, etc). */}
      <div className="eyebrow" style={{ marginTop: 4 }}>Role</div>
      <div className="chip-row">
        {roles.map(r => (
          <Selector
            key={r.key}
            selected={ch.role === r.key}
            onClick={() => onUpdate({ role: r.key })}
          >
            {r.label}
          </Selector>
        ))}
      </div>

      {/* Archetype — 20 presets + custom input + AI */}
      <div className="char-archetype-block">
        <div className="char-archetype-header">
          <span className="char-archetype-label">Archetype</span>
          {ch.archetype && <span className="char-archetype-current">{ch.archetype}</span>}
          <AIWandButton onClick={() => generateCharacterField("archetype")} loading={aiBusy === "archetype"} />
        </div>
        <div className="chip-row">
          {ARCHETYPE_PRESETS.map(a => (
            <Selector key={a} type="button"
              selected={ch.archetype === a}
              onClick={() => selectArchetype(a)}>
              {a}
            </Selector>
          ))}
          <button type="button"
            className={`chip chip-custom ${archetypeCustomOpen ? "selected" : ""}`}
            onClick={() => setArchetypeCustomOpen(o => !o)}>
            + Custom
          </button>
        </div>
        {archetypeCustomOpen && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Input
              value={archetypeInput}
              onChange={e => setArchetypeInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && archetypeInput.trim()) {
                  onUpdate({ archetype: archetypeInput.trim() });
                  setArchetypeInput("");
                  setArchetypeCustomOpen(false);
                }
              }}
              placeholder="Describe the archetype"
              style={{ flex: 1, marginBottom: 0 }}
              autoFocus
            />
            <Button variant="secondary" size="sm"
              onClick={() => {
                if (!archetypeInput.trim()) return;
                onUpdate({ archetype: archetypeInput.trim() });
                setArchetypeInput("");
                setArchetypeCustomOpen(false);
              }}
              disabled={!archetypeInput.trim()}
              style={{ flexShrink: 0 }}>
              Set
            </Button>
          </div>
        )}
      </div>

      <CharField
        label="Backstory"
        value={ch.backstory}
        onChange={v => onUpdate({ backstory: v })}
        onAI={() => generateCharacterField("backstory")}
        aiBusy={aiBusy === "backstory"}
        multiline rows={3}
        pager={pagerFor("backstory")}
      />

      <CharField
        label="Motivations"
        value={ch.motivations}
        onChange={v => onUpdate({ motivations: v })}
        onAI={() => generateCharacterField("motivations")}
        aiBusy={aiBusy === "motivations"}
        multiline rows={2}
        pager={pagerFor("motivations")}
      />

      <CharField
        label="Flaws"
        value={ch.flaws}
        onChange={v => onUpdate({ flaws: v })}
        onAI={() => generateCharacterField("flaws")}
        aiBusy={aiBusy === "flaws"}
        multiline rows={2}
        pager={pagerFor("flaws")}
      />

      <CharField
        label="What they want (external)"
        value={ch.want}
        onChange={v => onUpdate({ want: v })}
        onAI={() => generateCharacterField("want")}
        aiBusy={aiBusy === "want"}
        pager={pagerFor("want")}
      />

      <CharField
        label="What they need (internal)"
        value={ch.need}
        onChange={v => onUpdate({ need: v })}
        onAI={() => generateCharacterField("need")}
        aiBusy={aiBusy === "need"}
        pager={pagerFor("need")}
      />

      <CharField
        label="Voice / speaking style"
        value={ch.voice}
        onChange={v => onUpdate({ voice: v })}
        onAI={() => generateCharacterField("voice")}
        aiBusy={aiBusy === "voice"}
        multiline rows={2}
        pager={pagerFor("voice")}
      />

      <CharField
        label="Character arc"
        value={ch.arc}
        onChange={v => onUpdate({ arc: v })}
        onAI={() => generateCharacterField("arc")}
        aiBusy={aiBusy === "arc"}
        multiline rows={2}
        pager={pagerFor("arc")}
      />

      <CharField
        label="Additional notes"
        value={ch.notes}
        onChange={v => onUpdate({ notes: v })}
        onAI={() => generateCharacterField("notes")}
        aiBusy={aiBusy === "notes"}
        multiline rows={2}
        pager={pagerFor("notes")}
      />

      {/* Delete sits at the very bottom of the scrollable form — user must
          scroll past every field to reach it. No top action, no Done button
          (sheet Save is sticky in the footer). */}
      <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
        <Button
          variant="secondary"
          size="sm"
          style={{ color: "var(--ink-mute)" }}
          onClick={onRemove}
        >
          Delete character
        </Button>
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
  autosaveEnabled = true,
  onOpenUpdateTray,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  beats: Beat[];
  moments: Moment[];
  addBeat: (name: string, summary: string, insertAt?: number, characterIds?: string[]) => void;
  updateBeat: (id: string, patch: Partial<Beat>) => void;
  moveBeat: (index: number, direction: "up" | "down") => void;
  removeBeat: (id: string) => void;
  unlinkMoment: (beatId: string, momentId: string) => void;
  openMomentPicker: (beatId: string) => void;
  openBeatTray: (insertAt: number) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
  syncState: LayerSyncState;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
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
      <LayerBar layer="story" label="Story" story={story} setStory={setStory} autosaveEnabled={autosaveEnabled} onOpenUpdateTray={onOpenUpdateTray} />

      <div className={draggingIdx != null ? "beats-dragging" : ""}>
        {beats.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>&#9670;</div>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>No beats yet</div>
            <div className="caption" style={{ marginBottom: 16 }}>
              Start building your story structure — add your first beat.
            </div>
            <Button variant="primary" size="lg"
              onClick={() => openBeatTray(0)}
              className="entity-create-btn">
              + Add beat
            </Button>
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
                        <Input size="compact" value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={e => e.key === "Enter" && saveEdit()}
                          autoFocus />
                      </div>
                    ) : (
                      <div className="beat-text" onClick={() => startEdit(beat.id, "name", beat.name)}
                        style={{ cursor: "text" }}>
                        {beat.name || <span className="beat-text muted">Tap to edit</span>}
                      </div>
                    )}

                    <div className="beat-section-label">Summary</div>
                    {editingField?.beatId === beat.id && editingField.field === "summary" ? (
                      <Textarea size="compact" value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        autoFocus rows={4} />
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

                    {/* Characters-in-this-beat picker. Populated from the
                        active Characters-layer draft (same source the
                        BeatCreationForm uses) so the picker stays in
                        sync with whatever the user has in Characters —
                        add a character there and it immediately shows
                        up as a selectable chip here. Selection persists
                        onto `beat.characterIds`, which the AI consumes
                        when generating scene prose for this beat. */}
                    <div className="beat-section-label">Characters in this beat</div>
                    {(() => {
                      const namedChars = getActiveCharactersDraft(story).characters
                        .filter(c => c.name && c.name.trim() !== "");
                      if (namedChars.length === 0) {
                        return (
                          <div className="caption">
                            No characters yet. Add some in the Characters tab.
                          </div>
                        );
                      }
                      const selectedIds = beat.characterIds ?? [];
                      return (
                        <div className="chip-row">
                          {namedChars.map(c => {
                            const on = selectedIds.includes(c.id);
                            return (
                              <Selector
                                key={c.id}
                                selected={on}
                                onClick={() => {
                                  const next = on
                                    ? selectedIds.filter(x => x !== c.id)
                                    : [...selectedIds, c.id];
                                  updateBeat(beat.id, { characterIds: next });
                                }}
                              >
                                {c.name}
                              </Selector>
                            );
                          })}
                        </div>
                      );
                    })()}

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
                      <Button variant="secondary" size="sm"
                        onClick={() => openMomentPicker(beat.id)}>+ Link moment</Button>
                      <Button variant="secondary" size="sm"
                        style={{ color: "var(--ink-mute)" }}
                        onClick={() => removeBeat(beat.id)}>Remove</Button>
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
  autosaveEnabled = true,
  onOpenUpdateTray,
  onOpenReadThrough,
  onImportScript,
  importing,
  importStep,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  beats: Beat[];
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
  /** Open the read-through sheet — Studio owns state, ScriptTab just triggers. */
  onOpenReadThrough: () => void;
  /** Import a .txt/.pdf screenplay; deterministically populates
   *  Script + Characters + Story layers from the file contents. */
  onImportScript: (file: File) => Promise<void>;
  importing: boolean;
  /** Which layer is currently being written (drives progress label). */
  importStep: LayerKey | null;
}) {
  const d = getActiveScriptDraft(story);
  const charactersDraft = getActiveCharactersDraft(story);
  const conceptDraft = getActiveConceptDraft(story);
  const syncState = getLayerSyncState(story);
  const writtenCount = beats.filter(b => b.status === "written").length;
  // Only surface the sync banner once there's an actual script to be out of
  // date — i.e., at least one scene has been written.
  const hasProducedScript = writtenCount > 0;
  const isOutOfSync = syncState.scriptOutOfSync && hasProducedScript;

  function dismissSync() {
    setStory(s => markLayerSynced(s, "script"));
  }

  return (
    <>
      <LayerBar layer="script" label="Script" story={story} setStory={setStory} autosaveEnabled={autosaveEnabled} onOpenUpdateTray={onOpenUpdateTray} onOpenReadThrough={onOpenReadThrough} />

      {/* Out-of-sync banner — only after a script has been produced */}
      {isOutOfSync && (
        <div className="sync-banner">
          <button
            className="sync-banner-close"
            onClick={dismissSync}
            aria-label="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <div className="sync-banner-text">
            <span className="sync-dot inline" />
            Upstream content was updated.
            <br />Your script may need to be refreshed.
          </div>
        </div>
      )}

      {beats.length > 0 && (
        <div className="caption" style={{ marginBottom: 14 }}>
          {writtenCount}/{beats.length} scenes written.
        </div>
      )}

      {beats.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>&#127916;</div>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>No scenes yet</div>
          <div className="caption">
            Add beats in the <b>Story</b> tab first, then return here to write them into scenes.
          </div>
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
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <SpeakButton
                  mode="script"
                  size="md"
                  text={beat.sceneContent}
                  characters={charactersDraft.characters}
                  projectType={story.projectType}
                  genres={conceptDraft.settings.genres}
                  title="Read scene aloud"
                />
              </div>
              <div className="scene-content">{beat.sceneContent}</div>
            </div>
          )}
          {beat.status === "design" && (
            <div style={{ padding: "0 16px 16px" }}>
              <Button variant="primary" size="sm" disabled={busy}
                style={{ width: "100%" }}
                onClick={() => run(
                  { type: "generate_scene", payload: { beatIndex: i } },
                  `Write · ${beat.name}`
                )}>
                Write this scene
              </Button>
            </div>
          )}
        </div>
      ))}

      {/* Add Twist / Brainstorm row hidden for now — revisit later.
          Keeping the JSX in a gated block (rather than deleting) so the
          handlers and action wiring stay intact for when we restore it. */}
      {false && beats.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          <Button variant="secondary" size="sm" disabled={busy} style={{ flex: 1 }}
            onClick={() => run({ type: "add_twist", payload: {} }, "Add twist")}>&#9889; Add twist</Button>
          <Button variant="secondary" size="sm" disabled={busy} style={{ flex: 1 }}
            onClick={() => run(
              { type: "brainstorm", payload: { prompt: "ways to deepen the conflict" } },
              "Brainstorm"
            )}>&#9998; Brainstorm</Button>
        </div>
      )}

      {/* Info banner */}
      <div className="info-banner" style={{ marginTop: 16 }}>
        <span className="info-icon">i</span>
        <span>Script uses your Concept, Characters, and Story as inputs for AI generation.</span>
      </div>

      {/* ── Import an existing script ──────────────────────────────
          Lives at the bottom of the Script tab because that's where
          a user who arrived here and realized "I already have a
          screenplay, let me just upload it" ends up looking. The card
          parses the file, splits scenes on INT./EXT. headings, and
          deterministically populates three layers: Script (scenes),
          Story (one beat per scene, status=written, sceneContent
          copy-pasted), and Characters (verbatim dialogue cues). No
          AI interpretation — 100% fidelity to the uploaded file. */}
      <ImportScriptCard
        onImport={onImportScript}
        importing={importing}
        importStep={importStep}
      />
    </>
  );
}

// ── Import Script card ─────────────────────────────────────────────

function ImportScriptCard({
  onImport,
  importing,
  importStep,
}: {
  onImport: (file: File) => Promise<void>;
  importing: boolean;
  importStep: LayerKey | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    if (importing) return;
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear the input so the same file can be re-selected later (onChange
    // won't fire if the value didn't change).
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    await onImport(file);
  }

  const label = importing
    ? (importStep
        ? `Writing ${LAYER_LABEL[importStep]}…`
        : "Reading file…")
    : "Import a script";

  return (
    <div className="card import-script-card" style={{ marginTop: 16 }}>
      <span className="eyebrow">Have a finished script?</span>
      <div className="caption" style={{ marginTop: 6, marginBottom: 12 }}>
        Upload a .txt or .pdf screenplay. Unfold will split it into
        scenes word-for-word, then fill in Story beats, Characters, and
        a fresh Concept draft — preserving your title, format, and
        genres.
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        onChange={handleFile}
        style={{ display: "none" }}
      />
      <Button
        variant="secondary"
        size="lg"
        block
        onClick={openPicker}
        disabled={importing}
      >
        {importing && <span className="import-spinner" aria-hidden="true" />}
        {label}
      </Button>
      {importing && (
        <div className="caption" style={{ marginTop: 10, textAlign: "center" }}>
          Reading your script and splitting it into scenes…
        </div>
      )}
    </div>
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
  onSave: (name: string, summary: string, characterIds: string[]) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiSettings, setAISettings] = useState<BeatAISettings>(loadBeatAISettings);

  // Characters available for this beat — pulled from the active
  // Characters-layer draft. Only named characters are shown.
  const availableCharacters = getActiveCharactersDraft(story).characters
    .filter(c => c.name && c.name.trim() !== "");
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const toggleCharacter = (id: string) => {
    setSelectedCharIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };
  // Writer profile — injected into beat-generation requests so the
  // generated beat matches the user's voice + preference signature.
  const { profile } = useProfileCapture();

  async function callAI(actionType: string, payload: Record<string, any>,
    onResult: (parsed: any) => void) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story, action: { type: actionType, payload }, profile }),
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
      <Input placeholder="Beat name" value={name}
        onChange={e => setName(e.target.value)} />

      <Textarea placeholder="Describe this beat"
        value={summary} onChange={e => setSummary(e.target.value)} rows={4} />

      {/* Character picker. Always rendered so the user sees the
          feature exists even on a blank project; when no characters
          have been created yet we show an empty-state hint instead of
          hiding the whole section (hiding made new users think the
          picker was missing). */}
      <div style={{ marginTop: 4 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Characters in this beat
        </div>
        {availableCharacters.length === 0 ? (
          <div className="caption">
            No characters yet. Add some in the Characters tab.
          </div>
        ) : (
          <div className="chip-row">
            {availableCharacters.map(c => (
              <Selector
                key={c.id}
                selected={selectedCharIds.includes(c.id)}
                onClick={() => toggleCharacter(c.id)}
              >
                {c.name}
              </Selector>
            ))}
          </div>
        )}
      </div>

      {summary.trim() && (
        <Button variant="secondary" size="sm" block onClick={cleanUp}
          disabled={cleaning || busy || generating}>
          {cleaning ? "Cleaning..." : "Clean Up With AI"}
        </Button>
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
            <Button variant="primary" size="sm" onClick={createWithAI}
              disabled={generating} style={{ flex: 1 }}>
              {generating ? "Creating..." : "Create"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowAISettings(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button variant="secondary" size="sm"
          onClick={() => setShowAISettings(true)}
          disabled={busy || generating}
          style={{ flex: 1 }}>
          {generating ? "Creating..." : "Create with AI"}
        </Button>
        <Button variant="primary" size="sm" onClick={() => onSave(name || "Untitled beat", summary, selectedCharIds)}
          disabled={!summary.trim()}>
          Save
        </Button>
      </div>
    </div>
  );
}

/* ============================================ */
/* ============ SETTINGS TAB ================== */
/* ============================================ */

// Client-side center-crop + resize of a user-picked image into a 3:4
// JPEG data URL. Target 192x256 / quality 0.85 — same shape as what the
// DALL-E pipeline returns from /api/generate-thumbnail, so either source
// saves/loads the same way through Supabase + localStorage.
async function cropImageToPoster(file: File): Promise<string> {
  const OUT_W = 192;
  const OUT_H = 256; // 3:4
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image failed to load")); };
    el.src = url;
  });

  // Center-crop the source to 3:4 before drawing to the output canvas.
  const srcAspect = img.width / img.height;
  const targetAspect = OUT_W / OUT_H; // 0.75
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (srcAspect > targetAspect) {
    // Too wide — trim the sides.
    sw = Math.round(img.height * targetAspect);
    sx = Math.round((img.width - sw) / 2);
  } else if (srcAspect < targetAspect) {
    // Too tall — trim the top/bottom.
    sh = Math.round(img.width / targetAspect);
    sy = Math.round((img.height - sh) / 2);
  }

  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function SettingsTab({
  story, setStory,
  onLoadProjectDraft, onDeleteProjectDraft, onCreateProjectFromDraft,
  onDeleteLayerDraft,
  onRequestDeleteProject,
  onEmailProject,
  emailProjectBusy,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  onLoadProjectDraft: (id: string) => void;
  onDeleteProjectDraft: (id: string) => void;
  onCreateProjectFromDraft: (id: string) => void;
  onDeleteLayerDraft: (layer: LayerKey, draftId: string) => void;
  onRequestDeleteProject: () => void;
  /** Opens the email picker sheet (owned by app/page.tsx). Optional
   *  — renders the Email card only when provided. */
  onEmailProject?: () => void;
  emailProjectBusy?: boolean;
}) {
  const concept = getActiveConceptDraft(story);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

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
          extra: story.thumbnailPromptExtra || "",
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

  // Upload + center-crop a user-supplied image into a 3:4 JPEG data URL
  // matching the dimensions/quality produced by the DALL-E pipeline
  // (192x256, JPEG ~0.85). Keeps localStorage + Supabase payload sizes
  // comparable between generated and uploaded covers.
  async function uploadCover(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }
    setUploadingCover(true);
    try {
      const dataUrl = await cropImageToPoster(file);
      setStory(st => ({ ...st, thumbnail: dataUrl }));
    } catch (e) {
      alert(`Couldn't read that image: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadingCover(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
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

  const sortedProjectDrafts = [...story.projectDrafts].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <>
      <div className="display" style={{ marginBottom: 18 }}>Settings</div>

      <div className="card">
        <span className="eyebrow">Cover</span>
        {story.thumbnail && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <img
              src={story.thumbnail}
              alt=""
              style={{
                width: 160,
                aspectRatio: "3 / 4",
                borderRadius: 13,
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        )}
        {/* Prompt input + Regenerate button on one row. The input carries
            a leading pencil icon as its visual label (replacing the old
            "Custom prompt additions" eyebrow) and the button uses the
            same lightning-bolt glyph as the AI wand. */}
        <div className="cover-action-row">
          <div className="cover-prompt-wrap">
            <svg
              className="cover-prompt-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            <input
              type="text"
              className="attr-text-input cover-prompt-input"
              placeholder="Prompt additions"
              value={story.thumbnailPromptExtra || ""}
              onChange={e =>
                setStory(st => ({ ...st, thumbnailPromptExtra: e.target.value }))
              }
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={generateCover}
            disabled={generatingCover || uploadingCover}
            icon={
              <svg viewBox="0 0 100 110" fill="currentColor" aria-hidden="true">
                <path d="m41.785 60.52h-13.055c-0.52344-0.0078-1.0547-0.14844-1.5352-0.43359-1.4141-0.84766-1.8789-2.6836-1.0273-4.1016l31.906-53.211c0.60547-1.0117 1.7852-1.6094 3.0195-1.4141 1.6289 0.25391 2.7461 1.7773 2.4961 3.4102l-5.375 34.715h13.055c0.52344 0.0078 1.0547 0.14844 1.5352 0.43359 1.4141 0.84766 1.8789 2.6836 1.0273 4.1016l-31.906 53.211c-0.60547 1.0117-1.7852 1.6094-3.0195 1.4141-1.6289-0.25391-2.7461-1.7773-2.4961-3.4102z" />
              </svg>
            }
          >
            {generatingCover ? "Generating..." : "Regenerate"}
          </Button>
        </div>

        {/* Upload your own image — center-cropped to 3:4 client-side so
            the saved thumbnail matches the generated-cover dimensions. */}
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) uploadCover(f);
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => uploadInputRef.current?.click()}
          disabled={generatingCover || uploadingCover}
          style={{ width: "100%", marginTop: 8 }}
        >
          {uploadingCover ? "Uploading..." : "Upload image"}
        </Button>
      </div>

      {/* Project drafts */}
      <div className="card">
        <span className="eyebrow">Project Drafts</span>
        <div className="stack" style={{ marginTop: 10 }}>
          {sortedProjectDrafts.map(draft => {
            const isActive = draft.id === story.activeProjectDraftId;
            const canDelete = story.projectDrafts.length > 1;
            // Compose composition string (C1 + Ch4 + S2 + Sc1)
            const cNum  = story.conceptDrafts.find(x => x.id === draft.conceptDraftId)?.number ?? "?";
            const chNum = story.charactersDrafts.find(x => x.id === draft.charactersDraftId)?.number ?? "?";
            const sNum  = story.storyDrafts.find(x => x.id === draft.storyDraftId)?.number ?? "?";
            const scNum = story.scriptDrafts.find(x => x.id === draft.scriptDraftId)?.number ?? "?";
            return (
              <div key={draft.id} className="inset-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      Draft {draft.number}
                      {isActive && <span className="caption" style={{ marginLeft: 8 }}>· Active</span>}
                    </div>
                    <div className="caption" style={{ marginTop: 2 }}>
                      Concept {cNum} + Characters {chNum} + Story {sNum} + Script {scNum}
                    </div>
                    <div className="caption" style={{ marginTop: 2 }}>
                      Edited {formatDate(draft.updatedAt)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!isActive && (
                    <Button variant="secondary" size="sm"
                      onClick={() => onLoadProjectDraft(draft.id)}>
                      Load
                    </Button>
                  )}
                  <Button variant="secondary" size="sm"
                    onClick={() => onCreateProjectFromDraft(draft.id)}>
                    New project from this
                  </Button>
                  {canDelete && (
                    <Button variant="secondary" size="sm"
                      style={{ color: "var(--record)" }}
                      onClick={() => {
                        if (confirm(`Delete Project Draft ${draft.number}?`)) onDeleteProjectDraft(draft.id);
                      }}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Layer drafts — per-section list, each line item shows usage + delete */}
      {([
        { layer: "concept" as LayerKey,    label: "Concept Drafts",    pool: story.conceptDrafts,    refKey: "conceptDraftId"    as const },
        { layer: "characters" as LayerKey, label: "Characters Drafts", pool: story.charactersDrafts, refKey: "charactersDraftId" as const },
        { layer: "story" as LayerKey,      label: "Story Drafts",      pool: story.storyDrafts,      refKey: "storyDraftId"      as const },
        { layer: "script" as LayerKey,     label: "Script Drafts",     pool: story.scriptDrafts,     refKey: "scriptDraftId"     as const },
      ]).map(({ layer, label, pool, refKey }) => {
        const activePD = getActiveProjectDraft(story);
        const activeDraftId = activePD?.[refKey];
        const sorted = [...pool].sort((a, b) => a.number - b.number);
        return (
          <div key={layer} className="card">
            <span className="eyebrow">{label}</span>
            <div className="layer-draft-list">
              {sorted.map(d => {
                const isActive = d.id === activeDraftId;
                const usedByPDs = story.projectDrafts
                  .filter(pd => pd[refKey] === d.id)
                  .sort((a, b) => a.number - b.number);
                const referenced = usedByPDs.length > 0;
                const canDelete = !referenced && pool.length > 1;
                const usageLabel = referenced
                  ? usedByPDs.length === 1
                    ? `Used in Project Draft ${usedByPDs[0].number}`
                    : `Used in Project Drafts ${usedByPDs.map(pd => pd.number).join(", ")}`
                  : "Not used in any Project Draft";
                return (
                  <div key={d.id} className="layer-draft-item">
                    <div className="layer-draft-item-info">
                      <div className="layer-draft-item-title">
                        Draft {d.number}
                        {isActive && <span className="caption" style={{ marginLeft: 8 }}>· Active</span>}
                      </div>
                      <div className="caption" style={{ marginTop: 2 }}>{usageLabel}</div>
                      <div className="caption" style={{ marginTop: 2 }}>Edited {formatDate(d.updatedAt)}</div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      style={{
                        color: "var(--record)",
                        opacity: canDelete ? 1 : 0.4,
                        cursor: canDelete ? "pointer" : "not-allowed",
                      }}
                      disabled={!canDelete}
                      title={
                        !canDelete && referenced
                          ? "Cannot delete: used by a Project Draft"
                          : !canDelete
                            ? "Cannot delete the only draft"
                            : undefined
                      }
                      onClick={() => {
                        if (canDelete && confirm(`Delete Draft ${d.number}?`)) {
                          onDeleteLayerDraft(layer, d.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Email this project — sends the selected artifacts (PDF,
          .fountain, .json) to the signed-in user's email. Button
          opens a picker sheet owned by app/page.tsx so the caller
          chooses which attachments to include. */}
      {onEmailProject && (
        <div className="card" style={{ marginTop: 20 }}>
          <span className="eyebrow">Email</span>
          <div className="caption" style={{ marginTop: 6, marginBottom: 12 }}>
            Send this project — screenplay PDF, Fountain file, and JSON backup — to your inbox.
          </div>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => { if (!emailProjectBusy) onEmailProject(); }}
            disabled={emailProjectBusy}
          >
            {emailProjectBusy ? "Sending…" : "Email this project"}
          </Button>
        </div>
      )}

      {/* Danger zone: delete project */}
      <div className="card" style={{ marginTop: 20 }}>
        <span className="eyebrow">Danger Zone</span>
        <div className="caption" style={{ marginTop: 6, marginBottom: 12 }}>
          Permanently delete this project and all its drafts. This cannot be undone.
        </div>
        <button
          className="btn-delete-project"
          onClick={() => onRequestDeleteProject()}
        >
          Delete Project
        </button>
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
