"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import {
  Story, Beat, Episode, Character, CharacterRelationship, Scene, StorySettings, Reference,
  ConceptLayerDraft, CharactersLayerDraft, StoryLayerDraft, ScriptLayerDraft, ProjectDraft,
  LayerKey, LayerSyncState,
  getActiveProjectDraft,
  getActiveConceptDraft, getActiveCharactersDraft, getActiveStoryLayerDraft, getActiveScriptDraft,
  updateConceptDraft, updateCharactersDraft, updateStoryLayerDraft, updateScriptDraft,
  createNewLayerDraft, createEmptyLayerDraft, switchLayerDraft, deleteLayerDraft,
  createNewProjectDraft, duplicateActiveProjectDraft, createEmptyProjectDraft, switchProjectDraft, deleteProjectDraft,
  saveLayerDraft, isLayerDraftDirty,
  saveProjectDraft, isProjectDraftDirty,
  isLayerChangedForTabDot, isConceptFieldDirty, ConceptField,
  getLayerSyncState, markLayerSynced,
  isLayerDraftEmpty,
  applySyncResult,
  copyPartnerLayerDraft,
  copyPartnerProjectDraft,
  upsertCharacterInActiveDraft,
  copyConceptFieldFromPartner,
  type ConceptCopyField,
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
import { Button, Input, Textarea, Selector, Tip } from "@/components/ui";
import { SpeakButton } from "@/components/SpeakButton";
import { useDraftPickerStylePref, type DraftPickerStyle } from "@/lib/prefs";
import { useAuth } from "@/lib/auth";
import {
  createInvite,
  listInvitesForProject,
  revokeInvite,
  buildInviteUrl,
  type Invite,
} from "@/lib/invites";
import { loadMyProfile, saveMyDisplayName } from "@/lib/profiles";

type Section = "concept" | "characters" | "story" | "script";

// ── Partner Story / Identity Context ────────────────────────────────
// Phase 2 collaboration. When this project is shared, the parent
// (app/page.tsx) loads the partner's own row as a separate Story and
// passes it via the `partnerStory` prop, plus their email for the
// initials chip. We surface all of it through context rather than
// prop-drilling through every tab — only the LayerBar /
// PartnerDraftPicker / project-drafts picker consume it. Intermediate
// tab components don't need to know the partner exists.
interface PartnerIdentity {
  partnerStory?: Story;
  partnerEmail?: string;
  myEmail?: string;
  /** Stable creator/invitee pair for the overlapping-initials
   *  indicator. When present, CollabInitials renders
   *  creatorEmail on the left and inviteeEmail on the right
   *  regardless of which side the current viewer is on. */
  creatorEmail?: string;
  inviteeEmail?: string;
  /** First names captured via the name-capture modal. When present,
   *  the initials chip uses the name's first letter instead of the
   *  email's. Null/undefined = user hasn't set a name yet. */
  creatorDisplayName?: string | null;
  inviteeDisplayName?: string | null;
  /** The current viewer's captured display name. Separate from the
   *  creator/invitee variants above because we need it in the
   *  viewer-local fallback path (when projectMembers hasn't
   *  resolved, we put the viewer on LEFT with their own name if
   *  they've saved one). */
  myDisplayName?: string | null;
  /** Opens the name-capture modal. Exposed through context so the
   *  CollabInitials chip (rendered deep inside the LayerBar) can
   *  request it without prop-drilling. Undefined for solo projects. */
  onOpenNameCapture?: () => void;
  /** Enters partner-preview mode for a specific partner draft on a
   *  specific layer. Called when the user taps a partner row in the
   *  layer-drafts "Whose?" sheet. Studio swaps the tab content to
   *  render partner's draft read-only with a lock banner offering an
   *  explicit "Copy to my drafts" action. Undefined for solo projects. */
  onEnterPartnerPreview?: (layer: LayerKey, draftId: string) => void;
  /** True while Studio is rendering a partner draft via partner-preview
   *  mode. Drives the CollabInitials active-chip indicator: whichever
   *  side owns the draft currently on screen gets the inverted black-
   *  on-white circle and is pulled to the front of the overlap. */
  isPartnerPreviewing?: boolean;
  /** Which layer the preview is currently pinned to, if any. LayerBar
   *  uses this to decide whether THIS layer's bar should show the
   *  READ-ONLY indicator + render the partner's initial instead of
   *  the viewer's. `isPartnerPreviewing` alone is insufficient: it's
   *  a global boolean that stays true even when the user switches to
   *  a non-previewed tab. */
  previewLayer?: LayerKey;
  /** Copy a single character from the partner's currently-previewed
   *  characters draft into my own active characters draft, overwriting
   *  by id or case-insensitive name match if present, else appending.
   *  Only defined while `isPartnerPreviewing` is true and the preview
   *  layer is "characters". */
  onCopyPartnerCharacter?: (characterId: string) => void;
  /** Copy a single concept field from the partner's currently-previewed
   *  concept draft into my own active concept draft, overwriting the
   *  matching field. Only defined while `isPartnerPreviewing` is true
   *  and the preview layer is "concept". */
  onCopyPartnerConceptField?: (field: ConceptCopyField) => void;
}
const PartnerStoryContext = createContext<PartnerIdentity>({});
function usePartnerStory(): Story | undefined {
  return useContext(PartnerStoryContext).partnerStory;
}
function usePartnerIdentity(): PartnerIdentity {
  return useContext(PartnerStoryContext);
}

/** One-character initial derived from an email / display name, rendered
 *  uppercase. Falls back to "?" when nothing usable is available. */
function initialFor(email?: string | null): string {
  if (!email) return "?";
  const ch = email.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

/** Prefer the first letter of a captured display name over the email's
 *  first letter. Mirrors the fallback chain used everywhere the initials
 *  chip is rendered — name > email > "?". */
function initialForMember(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  if (displayName && displayName.trim()) return initialFor(displayName);
  return initialFor(email);
}

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
  partnerStory,
  partnerEmail,
  projectMembers,
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
  /** Phase 2 collaboration. The partner's own Story for the same
   *  project id (loaded via loadPartnerProjectData in app/page.tsx).
   *  Undefined for solo projects; drives every collab affordance in
   *  the layer bar. */
  partnerStory?: Story;
  /** Partner's email, used for the initials chip on every partner-side
   *  draft picker. Undefined for solo projects or when the RPC hasn't
   *  resolved yet — we fall back to "?" in that case. */
  partnerEmail?: string;
  /** Stable creator/invitee pair resolved from project_invites. Drives
   *  the overlapping-initials indicator on every layer bar — creator
   *  on the left, invitee on the right, same ordering on both sides.
   *  `displayName` is each side's captured first name (via the name-
   *  capture modal); null when the user hasn't set one yet. */
  projectMembers?: {
    creator: {
      userId: string;
      email: string | null;
      displayName: string | null;
    };
    invitee: {
      userId: string | null;
      email: string | null;
      displayName: string | null;
    };
  };
}) {
  const [section, setSection] = useState<Section>("concept");
  // Current user's email for the initials chip on the user's own side
  // of the dual pickers. useAuth gives us the live session; when the
  // session isn't hydrated yet we just render "?" until it is.
  const { user: authedUser } = useAuth();
  const myEmail = authedUser?.email ?? undefined;
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

  // ── Name-capture modal ────────────────────────────────────────────
  // Shown on entering a collab project whenever the signed-in user
  // hasn't yet set a display name in public.profiles. Also opened on
  // demand when the user taps the overlapping-initials chip (to edit
  // an existing name). Stays mounted at Studio level so every tab
  // shares the same instance.
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [nameModalMode, setNameModalMode] =
    useState<"first-time" | "edit">("first-time");
  const [myDisplayName, setMyDisplayName] = useState<string | null>(null);
  const [nameCaptureChecked, setNameCaptureChecked] = useState(false);
  const isCollabProject = !!partnerStory;
  // Load the signed-in user's own profile once per Studio mount. We
  // only auto-open the modal after the profile resolves (so we don't
  // flash it for users who already have a name set). Editing via the
  // initials tap doesn't depend on this load — it just reads the
  // latest cached value and opens.
  useEffect(() => {
    // Name-capture modal is currently disabled — we fall back to using
    // the first letter of each user's email for the initials chip,
    // which is available for free (no write needed). The NameCaptureModal
    // component + profiles load/save code are kept in place so we can
    // flip this back on later if we want named initials again. For now:
    // mark the check complete, never auto-open, never load profile.
    setNameCaptureChecked(true);
    setMyDisplayName(null);
  }, [isCollabProject, authedUser?.id]);

  function openNameCaptureForEdit() {
    setNameModalMode("edit");
    setNameModalOpen(true);
  }
  async function handleSaveDisplayName(name: string) {
    // Optimistic close: update the chip locally + close the modal
    // regardless of whether the DB write lands. The DB write is a
    // nice-to-have — the chip is driven off local state anyway, and
    // failing silently here (e.g., the `profiles` migration hasn't
    // been applied yet) should NOT trap the user inside a modal
    // they can never escape. Log the error but don't block.
    const trimmed = name.trim();
    if (!trimmed) return false;
    setMyDisplayName(trimmed);
    setNameModalOpen(false);
    saveMyDisplayName(trimmed).catch(err => {
      console.error("saveMyDisplayName failed (non-fatal):", err);
    });
    return true;
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
  // Two-step "whose drafts?" flow on the project-drafts sheet. Mirrors
  // the layer-draft picker behavior: for collab projects the sheet
  // shows a side picker (me vs partner) before drafting a list. Reset
  // to null every time the sheet closes.
  const [projectDraftsSide, setProjectDraftsSide] =
    useState<"mine" | "partner" | null>(null);
  const isCollabProjectForSheets = !!partnerStory;
  useEffect(() => {
    if (!draftsDropdownOpen) setProjectDraftsSide(null);
    // Solo projects: skip the picker, jump straight to the drafts list.
    else if (!isCollabProjectForSheets) setProjectDraftsSide("mine");
  }, [draftsDropdownOpen, isCollabProjectForSheets]);
  // Draft-picker presentation toggle. "sheet" = bottom-sheet (default,
  // current treatment); "popup" = inline dropdown menu that pops under
  // the trigger (legacy treatment preserved behind this preference).
  // Read once here and threaded into LayerDraftPicker so every draft
  // picker in the app follows the same user choice.
  const [draftPickerStyle] = useDraftPickerStylePref();
  // Portaled popup position — we portal the project-drafts popup to
  // document.body (same reasoning as the bottom-sheet) to escape the
  // .studio-scroll `-webkit-overflow-scrolling: touch` compositing trap
  // that hides inline-rendered descendants on iOS Safari. Portaling
  // means we lose the absolute-positioning anchor on .studio-header-
  // sticky, so we measure its on-screen rect at open time and pin the
  // popup at that y coordinate via inline style.
  const [projectPopupTop, setProjectPopupTop] = useState(0);
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
  // HTMLElement so the ref can accept either a <div> or a <button> —
  // currently the thumbnail renders as a <button> (tap-to-settings)
  // but handleScroll only reads .style.opacity, which lives on
  // HTMLElement, so this stays permissive.
  const thumbRef = useRef<HTMLElement>(null);
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

  // When the project-drafts popup opens in "popup" mode, measure the
  // sticky header's viewport position so the portaled menu can pin to
  // it. useLayoutEffect (not useEffect) so the measurement + state
  // update run AFTER DOM commit but BEFORE paint — the popup never
  // paints at its stale top: 0 default. Re-measured on every open,
  // not continuously; the popup closes on scroll/resize via its
  // backdrop or an explicit interaction anyway.
  useLayoutEffect(() => {
    if (!draftsDropdownOpen || draftPickerStyle !== "popup") return;
    const h = headerRef.current;
    if (!h) return;
    const rect = h.getBoundingClientRect();
    setProjectPopupTop(rect.top);
  }, [draftsDropdownOpen, draftPickerStyle]);

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
  // Tracks whether the current sheet session was opened via "New" (not
  // "Edit"). Used by CharacterEditForm to suppress the Delete-character
  // button — a not-yet-saved entity has nothing to delete. Reset to false
  // whenever we open an existing character.
  const [charSheetIsNew, setCharSheetIsNew] = useState<boolean>(false);
  // TV show episode drill-in
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  // Update-Other-Layers tray: null = closed, otherwise the source layer driving the sync.
  const [updateTraySource, setUpdateTraySource] = useState<LayerKey | null>(null);
  // Partner-preview mode. When set, the currently-visible tab renders
  // the PARTNER's draft for the given layer read-only — the user
  // cannot edit it. A sticky banner offers an explicit "Copy to my
  // drafts" action (the same clone that previously happened on tap)
  // and an "Exit" button to return to the user's own story. Set by
  // the layer-drafts "Whose?" sheet when the user taps a partner row.
  const [partnerPreview, setPartnerPreview] = useState<
    { layer: LayerKey; draftId: string } | null
  >(null);
  // Read-through player sheet (Script tab): shows the full script formatted
  // for reading with per-character voice playback.
  const [readThroughOpen, setReadThroughOpen] = useState(false);
  // Script-import pipeline state. `importing` drives the CTA's spinner;
  // `importStep` is whichever derived-layer is currently in flight so we
  // can show "Generating Concept…" etc. in the card.
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState<LayerKey | null>(null);

  // Full-screen "generating" scrim. Covers everything (including open
  // sheets) while a "Create all" action is in flight. Any open sheet is
  // closed at the start of the run so the scrim is the only thing on
  // screen. Driven by runGenerateAll below.
  const [generatingAll, setGeneratingAll] = useState(false);

  /** Close every Studio-owned sheet. Called at the start of a Create-all
   *  run so the scrim is unobstructed. LayerDraftPicker dropdowns live
   *  inside each tab and don't expose a setter here, so we close them
   *  via the existing `draft-dropdown:open` event bus — a detail value
   *  that doesn't match any picker id causes each to close itself. */
  const closeAllSheets = useCallback(() => {
    setDraftsDropdownOpen(false);
    setUpdateTraySource(null);
    setShowHelp(false);
    setShowSetup(false);
    setSheetOpen(false);
    setPickerOpen(false);
    setBeatTrayOpen(false);
    setReadThroughOpen(false);
    setConfirmDeleteProject(false);
    setCharSheetCharId(null);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("draft-dropdown:open", { detail: "__generating__" }),
      );
    }
  }, []);

  /** Wrap a Create-all async action: close sheets, show the scrim,
   *  await the work, hide the scrim. Errors are rethrown so the caller
   *  can still surface them (window.alert, etc.). */
  const runGenerateAll = useCallback(
    async (fn: () => Promise<void>) => {
      closeAllSheets();
      setGeneratingAll(true);
      try {
        await fn();
      } finally {
        setGeneratingAll(false);
      }
    },
    [closeAllSheets],
  );

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
  const openExistingCharacterSheet = (id: string) => {
    setCharSheetIsNew(false);
    setCharSheetCharId(id);
  };
  const openNewCharacterSheet = () => {
    setCharSheetIsNew(true);
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
    // Capture the character pre-close so we know whether we need to
    // kick off gender auto-detection. Reading from the live `story`
    // ref rather than inside the setStory updater is fine: auto-detect
    // is fire-and-forget, and the result patches back in via setStory
    // when it returns (or never, on error — the character is kept
    // without a gender, which is legal).
    const currentChars = getActiveCharactersDraft(story).characters;
    const pre = currentChars.find(c => c.id === id);

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

    // Gender auto-detect: fire-and-forget when the user left gender
    // unset AND the character has a name to go on AND it isn't about
    // to be auto-discarded. Swallow all errors — detection is a
    // convenience, not a correctness requirement. The result patches
    // back into the character via setStory if it arrives before the
    // user has edited the field themselves.
    const needsDetect =
      pre &&
      pre.name.trim().length > 0 &&
      !(pre.gender && pre.gender.trim().length > 0);
    if (needsDetect) {
      detectCharacterGender(pre.id).catch(err => {
        console.warn("Gender auto-detect skipped:", err);
      });
    }
  };

  // Call /api/generate with detect_character_gender and patch the
  // result into Character.gender. Guarded so a slow/failed detection
  // never overwrites a value the user typed in meanwhile.
  async function detectCharacterGender(characterId: string): Promise<void> {
    const action: ActionRequest = {
      type: "detect_character_gender",
      payload: { characterId },
    };
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story, action, profile: null }),
    });
    if (!res.ok || !res.body) return;
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
          if (msg.type === "text") fullText += msg.value;
        } catch {
          /* ignore malformed line */
        }
      }
    }
    const match = fullText.match(/\{[\s\S]*\}/);
    if (!match) return;
    let parsed: any;
    try { parsed = JSON.parse(match[0]); } catch { return; }
    const gender = typeof parsed?.gender === "string" ? parsed.gender.trim() : "";
    if (!gender) return;
    setStory(s => {
      const chars = getActiveCharactersDraft(s).characters;
      const ch = chars.find(c => c.id === characterId);
      // Don't overwrite if the user (or another code path) set
      // gender in the meantime. Only fill in when it's still blank.
      if (!ch || (ch.gender && ch.gender.trim().length > 0)) return s;
      return updateCharactersDraft(s, {
        characters: chars.map(c =>
          c.id === characterId ? { ...c, gender } : c
        ),
      });
    });
  }

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
        <SectionTabs section={section} setSection={setSection} story={story} autosaveEnabled={autosaveEnabled} />
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
                  <div className="caption">{ep.beats.length} scenes</div>
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
    <PartnerStoryContext.Provider value={{
      partnerStory,
      partnerEmail,
      myEmail,
      creatorEmail: projectMembers?.creator.email ?? undefined,
      inviteeEmail: projectMembers?.invitee.email ?? undefined,
      // Prefer the locally-captured display name when the side is the
      // current viewer — so hitting Save in the modal updates the chip
      // immediately, without waiting for the parent's projectMembers
      // RPC to refetch.
      creatorDisplayName:
        projectMembers?.creator.email && projectMembers.creator.email === myEmail
          ? (myDisplayName ?? projectMembers.creator.displayName ?? null)
          : (projectMembers?.creator.displayName ?? null),
      inviteeDisplayName:
        projectMembers?.invitee.email && projectMembers.invitee.email === myEmail
          ? (myDisplayName ?? projectMembers.invitee.displayName ?? null)
          : (projectMembers?.invitee.displayName ?? null),
      // Viewer's own display name — exposed separately so the
      // viewer-local fallback path in CollabInitials (when
      // projectMembers hasn't resolved) can still show a letter
      // derived from the captured name rather than the email.
      myDisplayName,
      // Name-capture edit is currently disabled (see useEffect above).
      // Keeping the handler defined but not wired so the chip is a
      // pure display element for now.
      onOpenNameCapture: undefined,
      // Enter partner-preview mode. The layer-drafts "Whose?" sheet
      // calls this when the user taps a partner row instead of
      // immediately cloning — the clone now happens explicitly from
      // the lock banner's "Copy to my drafts" action.
      onEnterPartnerPreview: (layer, draftId) => {
        setPartnerPreview({ layer, draftId });
        setSection(layer);
      },
      isPartnerPreviewing: !!partnerPreview,
      previewLayer: partnerPreview?.layer,
      // Per-item copy handlers from partner-preview. Only meaningful
      // while `partnerPreview` is active — the inline Copy affordances
      // inside CharactersTab/ConceptTab only render in that mode, so
      // exposing them unconditionally on the context is harmless.
      onCopyPartnerCharacter: partnerPreview && partnerStory && partnerPreview.layer === "characters"
        ? (characterId: string) => {
            const pool = getLayerPool(partnerStory, "characters") as CharactersLayerDraft[];
            const src = pool.find(d => d.id === partnerPreview.draftId);
            const ch = src?.characters.find(c => c.id === characterId);
            if (!ch) return;
            setStory(s => upsertCharacterInActiveDraft(s, ch));
          }
        : undefined,
      onCopyPartnerConceptField: partnerPreview && partnerStory && partnerPreview.layer === "concept"
        ? (field: ConceptCopyField) => {
            const pool = getLayerPool(partnerStory, "concept") as ConceptLayerDraft[];
            const src = pool.find(d => d.id === partnerPreview.draftId);
            if (!src) return;
            setStory(s => copyConceptFieldFromPartner(s, field, {
              title: partnerStory.title,
              projectType: partnerStory.projectType,
              draft: src,
            }));
          }
        : undefined,
    }}>
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
        {/* Thumbnail — scrolls with content, not sticky. Tapping it
            opens the project Settings panel, matching the gear icon in
            the top nav. Using a <button> (not the bare <div>) gives
            proper keyboard + accessibility semantics and a tap surface
            that doesn't fight with swipe gestures on iOS. */}
        <button
          type="button"
          className="studio-thumb-scroll studio-thumb-button"
          ref={thumbRef as React.RefObject<HTMLButtonElement>} /* see thumbRef decl — typed as HTMLElement to accept the <button> here */
          onClick={() => setShowSetup(true)}
          aria-label="Open project settings"
        >
          {story.thumbnail ? (
            <img src={story.thumbnail} alt="" className="project-header-thumb" />
          ) : (
            <div className="project-header-thumb project-header-thumb-placeholder">
              {story.title ? story.title.charAt(0).toUpperCase() : "?"}
            </div>
          )}
        </button>

        {/* Title + drafts dropdown + tabs — sticky, sticks below nav */}
        <div className="studio-header-sticky" ref={headerRef}>
          {/* Tapping the title opens the project-drafts picker — same
              action as the explicit "Draft N ▾" trigger below. Makes
              the whole top of the studio feel like one tap target for
              switching drafts; the sheet/popup respects whichever
              treatment the user chose in Help › Draft picker style. */}
          <button
            type="button"
            className="project-header-title project-header-title-btn"
            onClick={() => setDraftsDropdownOpen(v => !v)}
            aria-label="Open project drafts"
          >
            {story.title || "Untitled"}
          </button>

          {/* Project drafts dropdown trigger. Identical on solo and
              shared projects — collaboration is signaled by the
              overlapping-initials pair on the layer bar, not by
              duplicating the dropdown. */}
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

        </div>

        {/* Legacy popup treatment for the project-drafts dropdown.
            Portaled to document.body so it escapes the .studio-scroll
            `-webkit-overflow-scrolling: touch` compositing trap on iOS
            Safari (which was making the inline-rendered popup
            invisible). Position is measured from `.studio-header-
            sticky` when the popup opens — `projectPopupTop` holds the
            header's viewport y-coordinate at open time and the menu
            pins there via inline `top`. Gated on the "popup"
            preference; the default "sheet" mode uses the portaled
            bottom-sheet below instead. */}
        {draftPickerStyle === "popup" && draftsDropdownOpen && typeof document !== "undefined" && createPortal(
          <>
            <div className="drafts-dropdown-backdrop" onClick={() => setDraftsDropdownOpen(false)} />
            <div
              className="drafts-dropdown-menu project-draft-menu"
              style={{ position: "fixed", top: projectPopupTop }}
            >
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
              <div className="project-draft-menu-divider" aria-hidden="true" />
              {[...story.projectDrafts]
                .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                .map(draft => {
                  const isActive = draft.id === story.activeProjectDraftId;
                  const date = new Date(draft.updatedAt);
                  const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const timeStr = date
                    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                    .replace(" ", "");
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
          </>,
          document.body,
        )}

        {/* Project-drafts bottom sheet. Replaces the old inline
            dropdown menu: the trigger in the sticky header toggles
            `draftsDropdownOpen`, which slides this sheet up from the
            bottom. The draft list scrolls inside `.sheet-body`; the
            New Draft / Duplicate Draft action pair is pinned to a
            sticky footer so it stays reachable regardless of list
            length. The sheet is always mounted so the CSS slide
            transition can run both on open and close.

            Portaled to `document.body` so the backdrop's blur covers
            the sticky studio header (title + draft trigger) and the
            fixed studio-nav. Those ancestors sit in `.studio-scroll`,
            which creates a Safari compositing layer via
            `-webkit-overflow-scrolling: touch` — rendering the sheet
            there traps it below the header visually, regardless of
            z-index. Portaling escapes that compositing layer without
            reordering our sticky DOM.

            Skipped entirely when `draftPickerStyle === "popup"`, so
            users who prefer the legacy inline dropdown never pay for
            the portal + sheet markup at all. */}
        {draftPickerStyle === "sheet" && typeof document !== "undefined" && createPortal(
          <>
            <div
              className={`sheet-backdrop ${draftsDropdownOpen ? "open" : ""}`}
              onClick={() => setDraftsDropdownOpen(false)}
            />
            <div className={`sheet draft-sheet ${draftsDropdownOpen ? "open" : ""}`}>
              <div className="sheet-handle" />
              {(() => {
                const isCollab = isCollabProjectForSheets;
                // ── Step 1: "whose drafts?" (collab-only). Same
                // treatment as the per-layer picker — two rows with
                // the same overlapping-initials chip so the visual
                // language reads as one feature.
                if (isCollab && projectDraftsSide === null) {
                  // Labels are now email-primary: "My drafts" / "Partner's
                  // drafts" on top, the associated email underneath. The
                  // name-capture modal is currently disabled so we no
                  // longer use displayName anywhere in this sheet.
                  const mineEmail = myEmail ?? null;
                  const theirEmail = partnerEmail ?? null;
                  return (
                    <>
                      <div className="draft-sheet-title">{story.title || "Untitled"}</div>
                      <div className="draft-sheet-subtitle">
                        Whose drafts do you want to see?
                      </div>
                      <div className="sheet-body">
                        <button
                          className="drafts-whose-row"
                          onClick={() => setProjectDraftsSide("mine")}
                        >
                          <span className="drafts-whose-chip">
                            <span className="collab-initial">
                              {initialForMember(null, mineEmail)}
                            </span>
                          </span>
                          <span className="drafts-whose-text">
                            <span className="drafts-whose-label">My drafts</span>
                            {mineEmail && (
                              <span className="drafts-whose-email">{mineEmail}</span>
                            )}
                          </span>
                        </button>
                        <button
                          className="drafts-whose-row"
                          onClick={() => setProjectDraftsSide("partner")}
                        >
                          <span className="drafts-whose-chip">
                            <span className="collab-initial">
                              {initialForMember(null, theirEmail)}
                            </span>
                          </span>
                          <span className="drafts-whose-text">
                            <span className="drafts-whose-label">Partner's drafts</span>
                            {theirEmail && (
                              <span className="drafts-whose-email">{theirEmail}</span>
                            )}
                          </span>
                        </button>
                      </div>
                    </>
                  );
                }

                // ── Step 2: drafts list for the chosen side.
                const showingPartner = projectDraftsSide === "partner";
                const sourceStory =
                  showingPartner && partnerStory ? partnerStory : story;
                const sourceDrafts = [...sourceStory.projectDrafts].sort(
                  (a, b) =>
                    new Date(b.updatedAt).getTime() -
                    new Date(a.updatedAt).getTime(),
                );
                return (
                  <>
                    <div className="draft-sheet-title">
                      {story.title || "Untitled"}
                    </div>
                    <div className="draft-sheet-subtitle">
                      {showingPartner
                        ? "Partner's Project Drafts"
                        : "Project Drafts"}
                    </div>
                    <div className="sheet-body">
                      {sourceDrafts.map(draft => {
                        const isActive =
                          draft.id === sourceStory.activeProjectDraftId;
                        const date = new Date(draft.updatedAt);
                        const dateStr = date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        });
                        const timeStr = date
                          .toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })
                          .replace(" ", "");
                        const cNum =
                          sourceStory.conceptDrafts.find(
                            x => x.id === draft.conceptDraftId,
                          )?.number ?? "?";
                        const chNum =
                          sourceStory.charactersDrafts.find(
                            x => x.id === draft.charactersDraftId,
                          )?.number ?? "?";
                        const sNum =
                          sourceStory.storyDrafts.find(
                            x => x.id === draft.storyDraftId,
                          )?.number ?? "?";
                        const scNum =
                          sourceStory.scriptDrafts.find(
                            x => x.id === draft.scriptDraftId,
                          )?.number ?? "?";
                        return (
                          <button
                            key={draft.id}
                            className={`drafts-dropdown-item ${isActive ? "active" : ""}`}
                            // Tapping one of MY project drafts switches
                            // my active to it (same as today). Tapping
                            // one of the PARTNER's project drafts clones
                            // the whole 4-layer bundle onto my side as
                            // a fresh project draft and makes it active —
                            // the project-level analog of how the per-
                            // layer sheet handles partner rows.
                            onClick={() => {
                              if (showingPartner) {
                                if (partnerStory) {
                                  setStory(s =>
                                    copyPartnerProjectDraft(s, partnerStory, draft),
                                  );
                                }
                              } else {
                                handleLoadProjectDraft(draft.id);
                              }
                              setDraftsDropdownOpen(false);
                            }}
                          >
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
                      {sourceDrafts.length === 0 && (
                        <div
                          className="caption"
                          style={{ padding: "12px 4px", opacity: 0.7 }}
                        >
                          {showingPartner
                            ? "No project drafts on this side yet."
                            : "No project drafts yet."}
                        </div>
                      )}
                    </div>
                    {!showingPartner && (
                      <div className="sheet-sticky-footer">
                        <div className="draft-sheet-actions">
                          <Button
                            variant="primary"
                            size="lg"
                            onClick={handleCreateNewProjectDraft}
                            style={{ flex: 1 }}
                            icon={
                              <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <rect x="3.5" width="2" height="9" />
                                <rect y="5.5" width="2" height="9" transform="rotate(-90 0 5.5)" />
                              </svg>
                            }
                          >
                            New Draft
                          </Button>
                          <Button
                            variant="secondary"
                            size="lg"
                            onClick={handleDuplicateProjectDraft}
                            style={{ flex: 1 }}
                          >
                            Duplicate Draft
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </>,
          document.body,
        )}

        {/* Tab content. When in partner-preview mode for the current
            section, swap the `story` fed to the tab with a variant of
            `partnerStory` whose active layer draft is the previewed
            one, and replace `setStory` with a no-op so any stray write
            attempts die silently. The `.partner-preview-locked` wrapper
            applies `pointer-events: none` so inputs can't be clicked /
            typed into — the banner above stays interactive. */}
        {(() => {
          const previewActive = !!(
            partnerPreview &&
            partnerStory &&
            partnerPreview.layer === section
          );
          const previewStory = previewActive
            ? switchLayerDraft(partnerStory!, partnerPreview!.layer, partnerPreview!.draftId)
            : story;
          const tabStory  = previewActive ? previewStory : story;
          const tabSetStory: typeof setStory = previewActive ? (() => {}) : setStory;
          // Story-tab expects a derived `beats` list matching the
          // active story draft. When previewing, recompute it against
          // partner's currently-previewed draft so the beat order
          // reflects what the partner sees.
          const tabBeats = previewActive
            ? (() => {
                const pd = getActiveProjectDraft(previewStory);
                const sd = previewStory.storyDrafts.find(s => s.id === pd.storyDraftId);
                return sd ? [...sd.beats].sort((a, b) => a.position - b.position) : [];
              })()
            : sorted;
          // Previous design rendered a full-width "lock icon + email +
          // draft number + Copy" banner above each tab while in partner
          // preview. That bar was deleted in favor of a compact
          // READ-ONLY + lock icon on the right side of the LayerBar
          // itself (see LayerBar below). The copy affordance moved to
          // per-row inline buttons (see per-field Copy in ConceptTab and
          // per-card Copy in CharactersTab). Exit-from-preview now
          // happens by selecting a different draft in the layer-drafts
          // picker, so no dedicated close button is needed here.
          return (
            <>
              <div
                style={{ padding: "8px 22px 40px" }}
                className={previewActive ? "partner-preview-locked" : undefined}
                aria-hidden={previewActive ? true : undefined}
              >
          {section === "concept" && (
            <ConceptTab
              story={tabStory}
              setStory={tabSetStory}
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
            />
          )}
          {section === "characters" && (
            <CharactersTab
              story={tabStory}
              setStory={tabSetStory}
              run={run}
              busy={busy}
              openNewCharacter={openNewCharacterSheet}
              openCharacter={openExistingCharacterSheet}
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
              runGenerateAll={runGenerateAll}
            />
          )}
          {section === "story" && (
            <StoryTab
              story={tabStory}
              setStory={tabSetStory}
              beats={tabBeats}
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
              runGenerateAll={runGenerateAll}
            />
          )}
          {section === "script" && (
            <ScriptTab
              story={tabStory}
              setStory={tabSetStory}
              beats={tabBeats}
              moments={moments}
              run={run}
              busy={busy}
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
              onOpenReadThrough={() => setReadThroughOpen(true)}
              runGenerateAll={runGenerateAll}
              onImportScript={importScriptFromFile}
              importing={importing}
              importStep={importStep}
              onAddScene={() => {
                // Scene (beat) creation lives on the Story tab. Switch
                // over and open the creation tray inserting at the end
                // so the user lands exactly where they expect.
                setSection("story");
                setBeatTrayInsertAt(sorted.length);
                setBeatTrayOpen(true);
              }}
            />
          )}
              </div>
            </>
          );
        })()}
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

          {/* Preferences — lives at the bottom of the help sheet so it
              stays out of the way of first-time explainer copy but is
              still reachable for anyone opening Help. Currently exposes
              a single choice: how draft dropdowns appear on screen. */}
          <div className="draft-picker-style-pref">
            <div className="draft-picker-style-pref-label">Draft picker style</div>
            <div className="draft-picker-style-pref-caption">
              Choose how the project and section draft dropdowns appear.
            </div>
            <DraftPickerStyleToggle />
          </div>
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
          <div className="sheet-title">New scene</div>
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
                    isNew={charSheetIsNew}
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
        setStory={setStory}
        onClose={() => setReadThroughOpen(false)}
      />

      {confirmDeleteDialog}

      {/* Full-screen generating scrim. Portaled to <body> so its
          blurred dark backdrop covers everything — sticky header,
          fixed nav, the whole viewport — without fighting the
          stacking inside .studio-scroll. Driven by the Studio-level
          `generatingAll` flag; mounted only when true so there's no
          idle z-index tax. */}
      {generatingAll && typeof document !== "undefined" && createPortal(
        <div className="generate-scrim" role="status" aria-live="polite" aria-label="Generating">
          <div className="generate-scrim-spinner" />
        </div>,
        document.body,
      )}

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

      {/* Name-capture modal — shown on collab-project entry when the
          signed-in user hasn't set a display name yet, and on-demand
          when they tap the overlapping-initials chip to edit. Only
          mounted once we've checked the profile, to avoid flashing it
          in front of users who already have a name on file. */}
      {isCollabProject && nameCaptureChecked && (() => {
        // Identify the partner (the OTHER side) so we can greet the
        // current user with "You're collaborating with <partner>".
        // Uses projectMembers (stable creator/invitee pair from the
        // project_invites-backed RPC). Falls back to email when the
        // partner hasn't set a name yet.
        const meIsCreator =
          !!(projectMembers?.creator.email && projectMembers.creator.email === myEmail);
        const partner = meIsCreator
          ? projectMembers?.invitee
          : projectMembers?.creator;
        return (
          <NameCaptureModal
            open={nameModalOpen}
            mode={nameModalMode}
            initialName={myDisplayName}
            partnerDisplayName={partner?.displayName ?? null}
            partnerEmail={partner?.email ?? null}
            onSave={handleSaveDisplayName}
            onCancel={() => setNameModalOpen(false)}
          />
        );
      })()}

      {/* Project-created toast (same pattern as Idea Added on main page) */}
      <div className={`toast ${showSuccess ? "show" : ""}`}>Project Created</div>
    </PartnerStoryContext.Provider>
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
        // Tab dirty-dot rendering rule: only show when autosave is
        // TOGGLED ON in the main menu AND the layer has unsaved changes.
        // Mirrors the counterintuitive semantics used by the layer-draft
        // Save button above — the dot surfaces "something changed" only
        // when the user has opted into autosave as their chosen mode.
        // When autosave is OFF, we suppress tab dots entirely.
        const dot = autosaveEnabled && isLayerChangedForTabDot(story, t.layer);
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
  // Two-step side picker — only surfaces for collab projects. First
  // step asks "whose drafts?" (me vs partner); second step lists
  // drafts for the chosen side. Reset to null every time the sheet
  // closes so each re-open starts at the picker again.
  const {
    partnerStory,
    creatorEmail,
    inviteeEmail,
    creatorDisplayName,
    inviteeDisplayName,
    myEmail,
    partnerEmail,
    onEnterPartnerPreview,
  } = usePartnerIdentity();
  const isCollab = !!partnerStory;
  const [side, setSide] = useState<"mine" | "partner" | null>(null);
  useEffect(() => {
    if (!open) setSide(null);
    // Auto-advance for solo projects — no side picker needed.
    else if (!isCollab) setSide("mine");
  }, [open, isCollab]);
  // Presentation style pref — "sheet" (default, bottom-sheet) or
  // "popup" (legacy inline dropdown menu). Read here so every
  // per-layer picker across the app tracks the same user choice
  // without prop-threading through tab components.
  const [pickerStyle] = useDraftPickerStylePref();
  // Trigger ref + measured popup position — used when `pickerStyle`
  // is "popup" so the popup can be portaled to document.body (same
  // reason as the project-drafts popup: escape the `.studio-scroll`
  // `-webkit-overflow-scrolling: touch` compositing trap on iOS
  // Safari that otherwise hides inline-rendered descendants).
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });

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

  // Measure trigger position when the popup opens so the portaled
  // menu can anchor just below the trigger (mirrors the original
  // `top: calc(100% - 4px)` anchoring). useLayoutEffect so the
  // measurement + state update run before the browser paints the
  // opening popup — prevents a visible flash at 0,0 between mount
  // and measurement. Re-measured on every open; we don't track
  // scroll/resize while open because the popup closes on backdrop
  // click/scroll in practice.
  useLayoutEffect(() => {
    if (!open || pickerStyle !== "popup") return;
    const t = triggerRef.current;
    if (!t) return;
    const rect = t.getBoundingClientRect();
    // Anchor the popup's LEFT edge to the trigger's left edge (not
    // centered below it). Per product direction — the layer draft
    // popup should read as a dropdown that hangs straight down from
    // its trigger, rather than a menu that fans out symmetrically.
    setPopupPos({
      top: rect.bottom - 4,
      left: rect.left,
    });
  }, [open, pickerStyle]);

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

  // "New Draft" — fresh empty layer draft. For Concept this preserves
  // the user's genres (project-identity level); everything else blanks.
  const handleCreate = () => {
    setStory(s => createEmptyLayerDraft(s, layer));
    setOpen(false);
  };
  // "Duplicate Draft" — clone the active draft's content forward
  // under a new id + number (existing createNewLayerDraft semantics).
  const handleDuplicate = () => {
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

  // Collaboration indicator lives on the layer bar (CollabInitials),
  // not inside the draft trigger itself — the picker looks identical
  // on solo and shared projects.

  return (
    <div className="layer-draft-picker">
      <button
        ref={triggerRef}
        className="layer-draft-trigger"
        onClick={() => setOpen(v => !v)}
      >
        <span className="layer-draft-label">{label} Draft {active.number}</span>
        <img src="/caret-sm.svg" alt="" className={`drafts-caret ${open ? "open" : ""}`} />
      </button>
      {/* Save-draft button rendering rule: only show when autosave is
          TOGGLED ON in the main menu AND the active draft has local
          edits. Counterintuitive vs. typical autosave UX (where a
          manual Save appears when autosave is OFF), but matches the
          explicit product ask — the button is meant as an optional
          "commit this draft now" action when autosave is the chosen
          mode, and stays hidden when autosave is off. */}
      {autosaveEnabled && isDirty && (
        <button className="draft-save-btn" onClick={handleSave} aria-label={`Save ${label} Draft ${active.number}`}>
          Save {label} Draft {active.number}
        </button>
      )}

      {/* Legacy popup treatment. Portaled to document.body so the
          menu escapes the `.studio-scroll` `-webkit-overflow-
          scrolling: touch` compositing trap on iOS Safari (which
          was hiding the inline-rendered version). Anchored below
          the trigger via the measured `popupPos` computed above.
          Gated on the "popup" preference. */}
      {pickerStyle === "popup" && open && typeof document !== "undefined" && createPortal(
        <>
          <div className="drafts-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div
            className="drafts-dropdown-menu layer-draft-menu"
            style={{
              position: "fixed",
              top: popupPos.top,
              left: popupPos.left,
              /* No translateX — popup's left edge sits on the
                 trigger's left edge per the left-aligned anchoring
                 set in the layout effect above. */
            }}
          >
            <div className="layer-draft-menu-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreate}
                style={{ flex: 1 }}
              >
                New Draft
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDuplicate}
                style={{ flex: 1 }}
              >
                Duplicate Draft
              </Button>
            </div>
            <div className="layer-draft-menu-divider" aria-hidden="true" />
            {sorted.map((d: any) => {
              const isActive = d.id === activeId;
              const date = new Date(d.updatedAt);
              const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              // Time rendered the same way as the project-draft popup
              // (e.g. "3:45pm") — the " · " separator joins them into
              // one "Mon D · h:MMam" string for parity with that menu.
              const timeStr = date
                .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                .replace(" ", "");
              return (
                <button
                  key={d.id}
                  className={`drafts-dropdown-item ${isActive ? "active" : ""}`}
                  onClick={() => handleSwitch(d.id)}
                >
                  <span>Draft {d.number}</span>
                  <span className="drafts-dropdown-date">{dateStr} · {timeStr}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}

      {/* Layer-draft bottom sheet. Always mounted so the slide
          transition runs on open AND close — toggled by `open`,
          which also drives the trigger caret. Draft list scrolls
          inside `.sheet-body`; the New Draft / Duplicate Draft
          actions pin to a sticky footer so they never scroll off.

          Portaled to `document.body` so the backdrop's blur covers
          the sticky studio header (title + draft trigger) and the
          fixed studio-nav — same reasoning as the project-draft
          sheet above.

          Skipped entirely when `pickerStyle === "popup"` so the
          legacy inline dropdown above is the only surface rendered. */}
      {pickerStyle === "sheet" && typeof document !== "undefined" && createPortal(
        <>
          <div
            className={`sheet-backdrop ${open ? "open" : ""}`}
            onClick={() => setOpen(false)}
          />
          <div className={`sheet draft-sheet ${open ? "open" : ""}`}>
            <div className="sheet-handle" />
            {(() => {
              // ── Step 1: "Whose drafts?" picker (collab-only).
              // Shown when a side hasn't been chosen yet. Two rows,
              // each with the same overlapping-initials treatment as
              // the layer bar so the visual language is consistent.
              if (isCollab && side === null) {
                // Label rows by email only — name-capture UI is turned
                // off so we lean on the email + first-letter initial
                // for identity. Each row stacks a bold label over the
                // associated email as a subtitle for clarity.
                const mineEmail = myEmail ?? null;
                const theirEmail = partnerEmail ?? null;
                return (
                  <>
                    <div className="draft-sheet-title">{label} Drafts</div>
                    <div className="draft-sheet-subtitle">
                      Whose drafts do you want to see?
                    </div>
                    <div className="sheet-body">
                      <button
                        className="drafts-whose-row"
                        onClick={() => setSide("mine")}
                      >
                        <span className="drafts-whose-chip">
                          <span className="collab-initial">
                            {initialForMember(null, mineEmail)}
                          </span>
                        </span>
                        <span className="drafts-whose-text">
                          <span className="drafts-whose-label">My drafts</span>
                          {mineEmail && (
                            <span className="drafts-whose-email">
                              {mineEmail}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        className="drafts-whose-row"
                        onClick={() => setSide("partner")}
                      >
                        <span className="drafts-whose-chip">
                          <span className="collab-initial">
                            {initialForMember(null, theirEmail)}
                          </span>
                        </span>
                        <span className="drafts-whose-text">
                          <span className="drafts-whose-label">
                            Partner's drafts
                          </span>
                          {theirEmail && (
                            <span className="drafts-whose-email">
                              {theirEmail}
                            </span>
                          )}
                        </span>
                      </button>
                    </div>
                  </>
                );
              }

              // ── Step 2: drafts list for the chosen side.
              const showingPartner = side === "partner";
              const sourceStory = showingPartner && partnerStory ? partnerStory : story;
              const sourcePool: any[] = (
                layer === "concept"    ? sourceStory.conceptDrafts :
                layer === "characters" ? sourceStory.charactersDrafts :
                layer === "story"      ? sourceStory.storyDrafts :
                                         sourceStory.scriptDrafts
              );
              const sourcePd = getActiveProjectDraft(sourceStory);
              const sourceActiveId = (
                layer === "concept"    ? sourcePd.conceptDraftId :
                layer === "characters" ? sourcePd.charactersDraftId :
                layer === "story"      ? sourcePd.storyDraftId :
                                         sourcePd.scriptDraftId
              );
              const sourceSorted = [...sourcePool].sort((a: any, b: any) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
              );
              // Tapping a partner draft enters partner-preview mode —
              // Studio swaps the tab content to render the selected
              // partner draft read-only with a lock banner offering an
              // explicit "Copy to my drafts" action. Tapping one of my
              // own drafts switches my active to it, as today.
              const handleTap = (d: any) => {
                if (showingPartner) {
                  onEnterPartnerPreview?.(layer, d.id);
                } else {
                  setStory(s => switchLayerDraft(s, layer, d.id));
                }
                setOpen(false);
              };
              return (
                <>
                  <div className="draft-sheet-title">{label} Drafts</div>
                  {isCollab && (
                    <div className="draft-sheet-subtitle">
                      {showingPartner ? "Partner's drafts" : "My drafts"}
                    </div>
                  )}
                  <div className="sheet-body">
                    {sourceSorted.map((d: any) => {
                      const isActive = d.id === sourceActiveId;
                      const date = new Date(d.updatedAt);
                      const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      return (
                        <button
                          key={d.id}
                          className={`drafts-dropdown-item ${isActive ? "active" : ""}`}
                          onClick={() => handleTap(d)}
                        >
                          <span className="drafts-dropdown-name">
                            {showingPartner && (
                              <svg
                                className="drafts-dropdown-lock"
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                              >
                                <rect x="4" y="11" width="16" height="10" rx="2" />
                                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                              </svg>
                            )}
                            Draft {d.number}
                          </span>
                          <span className="drafts-dropdown-date">{dateStr}</span>
                        </button>
                      );
                    })}
                    {sourceSorted.length === 0 && (
                      <div
                        className="caption"
                        style={{ padding: "12px 4px", opacity: 0.7 }}
                      >
                        {showingPartner
                          ? "No drafts on this side yet."
                          : "No drafts yet."}
                      </div>
                    )}
                  </div>
                  {/* New / Duplicate footer only applies to MY side —
                      those actions create drafts on my own Story and
                      aren't meaningful while viewing the partner's. */}
                  {!showingPartner && (
                    <div className="sheet-sticky-footer">
                      <div className="draft-sheet-actions">
                        <Button
                          variant="primary"
                          size="lg"
                          onClick={handleCreate}
                          style={{ flex: 1 }}
                          icon={
                            <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <rect x="3.5" width="2" height="9" />
                              <rect y="5.5" width="2" height="9" transform="rotate(-90 0 5.5)" />
                            </svg>
                          }
                        >
                          New Draft
                        </Button>
                        <Button
                          variant="secondary"
                          size="lg"
                          onClick={handleDuplicate}
                          style={{ flex: 1 }}
                        >
                          Duplicate Draft
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

/* ============================================ */
/* ====== DRAFT PICKER STYLE — PREF TOGGLE ===== */
/* ============================================ */
//
// Two-option segmented control backing `useDraftPickerStylePref`.
// Lives at the bottom of the "How this page works" help sheet so the
// user can swap between bottom-sheet (default) and the legacy inline
// popup for all draft dropdowns (project-level and per-layer). Change
// takes effect on the next dropdown open — no reload needed.
function DraftPickerStyleToggle() {
  const [style, setStyle] = useDraftPickerStylePref();
  const options: { value: DraftPickerStyle; label: string; hint: string }[] = [
    { value: "sheet", label: "Bottom sheet", hint: "Slides up from the bottom." },
    { value: "popup", label: "Popup",         hint: "Drops under the trigger." },
  ];
  return (
    <div className="draft-picker-style-toggle" role="radiogroup" aria-label="Draft picker style">
      {options.map(opt => {
        const active = style === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`draft-picker-style-option ${active ? "active" : ""}`}
            onClick={() => setStyle(opt.value)}
          >
            <span className="draft-picker-style-option-label">{opt.label}</span>
            <span className="draft-picker-style-option-hint">{opt.hint}</span>
          </button>
        );
      })}
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

/* ── Collab indicator ──
 * Two slightly-overlapping initial chips pinned to the right of the
 * sticky layer-draft bar on any project that has a collaborator. The
 * first chip is the current viewer's initial, the second is the
 * partner's — both are derived from their email address (or display
 * name, once we capture one) via `initialFor`. Renders nothing for
 * solo projects so the bar stays identical to the non-collab case. */
/* ── Collaborator initials pair ──
 * Two overlapping outlined circles rendered on the LEFT of each
 * LayerBar's draft dropdown — creator first, invitee second, overlap
 * by 4px. Hidden on solo projects. Both chips use the outlined style
 * (no dark-fill active indicator); neither is badged as "active" so
 * the pair simply signals "this project has two collaborators".
 *
 * The `layer` prop is unused today — kept on the signature so a
 * future active/inactive visual could distinguish which side owns
 * the currently-viewed draft without re-threading context. */
function ActiveDraftInitial({ layer: _layer }: { layer: LayerKey }) {
  const {
    partnerStory,
    creatorEmail,
    inviteeEmail,
    creatorDisplayName,
    inviteeDisplayName,
    myEmail,
    myDisplayName,
    partnerEmail,
  } = usePartnerIdentity();
  // Solo projects: nothing to show.
  if (!partnerStory) return null;

  // Canonical ordering: creator LEFT, invitee RIGHT — stable across
  // viewers so the pair reads the same for both collaborators. Fall
  // back to viewer-local (me-left / partner-right) when project-
  // members data hasn't resolved yet so at least one circle renders.
  let leftName: string | null = null;
  let leftEmail: string | null = null;
  let rightName: string | null = null;
  let rightEmail: string | null = null;

  if (creatorEmail || inviteeEmail) {
    leftEmail = creatorEmail ?? null;
    leftName = creatorDisplayName ?? null;
    rightEmail = inviteeEmail ?? null;
    rightName = inviteeDisplayName ?? null;
    const iAmLeft = !!(creatorEmail && myEmail && creatorEmail === myEmail);
    const iAmRight = !!(inviteeEmail && myEmail && inviteeEmail === myEmail);
    if (!leftEmail) {
      if (iAmRight) {
        leftEmail = partnerEmail ?? null;
      } else {
        leftEmail = myEmail ?? null;
        leftName = myDisplayName ?? null;
      }
    }
    if (!rightEmail) {
      if (iAmLeft) {
        rightEmail = partnerEmail ?? null;
      } else {
        rightEmail = myEmail ?? null;
        rightName = myDisplayName ?? null;
      }
    }
  } else {
    // No canonical data yet — viewer-local fallback.
    leftEmail = myEmail ?? null;
    leftName = myDisplayName ?? null;
    rightEmail = partnerEmail ?? null;
  }

  const leftChar = letterOrNull(leftName, leftEmail);
  const rightChar = letterOrNull(rightName, rightEmail);
  if (!leftChar && !rightChar) return null;

  return (
    <span className="layer-owner-initials-pair" aria-hidden="true">
      {leftChar && <span className="layer-owner-initial">{leftChar}</span>}
      {rightChar && <span className="layer-owner-initial">{rightChar}</span>}
    </span>
  );
}

/** Returns an uppercase single-character initial derived from the
 *  display name (preferred) or the email. Returns null when neither
 *  yields a usable character — callers should skip rendering that
 *  circle rather than fall through to "?". */
function letterOrNull(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const name = (displayName ?? "").trim();
  if (name) return name.charAt(0).toUpperCase();
  const em = (email ?? "").trim();
  if (em) return em.charAt(0).toUpperCase();
  return null;
}

/* ============================================ */
/* =========== NAME CAPTURE MODAL ============= */
/* ============================================ */
//
// Shown on entering a shared project whenever the signed-in user
// hasn't set a display name yet, and on-demand when they tap the
// overlapping-initials chip. One-field form: first name + Save.
//
// Why we prompt: the layer-bar initials chip defaults to the first
// letter of each side's email, which collides and feels impersonal.
// A name personalizes the chip and unblocks future name-aware copy
// ("Madison is editing scene 3…"). Backed by public.profiles.
//
// Dismissal rules:
//   * First-time mode (user has no name yet): backdrop tap does NOT
//     dismiss — they have to type a name. This is by design; the
//     modal must re-appear every entry until a name is captured.
//   * Edit mode (user already has a name and tapped the chip to
//     change it): backdrop tap cancels, restoring the prior name.
function NameCaptureModal({
  open,
  mode,
  initialName,
  partnerDisplayName,
  partnerEmail,
  onSave,
  onCancel,
}: {
  open: boolean;
  mode: "first-time" | "edit";
  initialName: string | null;
  partnerDisplayName: string | null;
  partnerEmail: string | null;
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName ?? "");
  const [saving, setSaving] = useState(false);
  // Reset the input whenever the modal re-opens, so an edit session
  // starts with the current name pre-filled and a first-time session
  // always starts empty.
  useEffect(() => {
    if (open) {
      setValue(initialName ?? "");
      setSaving(false);
    }
  }, [open, initialName]);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const ok = await onSave(trimmed);
    if (!ok) setSaving(false);
  }

  const partnerLabel =
    partnerDisplayName?.trim() || partnerEmail || "someone";

  return (
    <>
      {/* Backdrop tap closes the sheet in BOTH modes. We used to block
          dismissal in first-time mode to force a name capture, but the
          modal re-opens on the next project entry anyway — no point
          holding the user hostage here. */}
      <div
        className={`sheet-backdrop ${open ? "open" : ""}`}
        onClick={onCancel}
      />
      <div className={`sheet name-capture-sheet ${open ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-body">
          <div
            className="display heading"
            style={{ marginTop: 25, marginBottom: 8 }}
          >
            {mode === "edit" ? "Your name" : "Introductions?"}
          </div>
          <div className="caption" style={{ marginBottom: 20 }}>
            {mode === "edit" ? (
              <>Change what {partnerLabel} sees next to your work on this project.</>
            ) : (
              <>
                You're sharing this project with <strong>{partnerLabel}</strong>.
                A first name makes it a lot easier to tell whose genius wrote
                which beat — beats squinting at <em>{"m@…"}</em> vs{" "}
                <em>{"m@…"}</em> in the credits.
              </>
            )}
          </div>

          <Input
            autoFocus
            type="text"
            placeholder="First name"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setValue(e.target.value)
            }
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              }
            }}
            disabled={saving}
          />

          <Button
            variant="primary"
            size="lg"
            block
            onClick={handleSave}
            disabled={!value.trim() || saving}
            style={{ marginTop: 20 }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>

          <Button
            variant="secondary"
            size="lg"
            block
            onClick={onCancel}
            disabled={saving}
            style={{ marginTop: 10 }}
          >
            {mode === "edit" ? "Cancel" : "Not now"}
          </Button>
        </div>
      </div>
    </>
  );
}

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
  const { previewLayer } = usePartnerIdentity();
  // READ-ONLY badge only on the bar for the exact layer we're
  // previewing. Global `isPartnerPreviewing` stays true even after the
  // user taps another tab, which would incorrectly badge their own
  // drafts as read-only.
  const showReadOnly = previewLayer === layer;
  return (
    <div className="layer-bar">
      <ActiveDraftInitial layer={layer} />
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

      {/* READ-ONLY indicator — pinned to the right edge via margin-left:
          auto on the CSS rule. Replaces the old lock-banner that sat
          above the tab content; that bar is gone and its exit action
          is served by the layer-drafts picker (select any own-side
          draft to leave preview mode). */}
      {showReadOnly && (
        <span className="layer-read-only-indicator" role="status">
          <img src="/read-only-lock.svg" alt="" className="layer-read-only-lock" />
          <span>READ ONLY</span>
        </span>
      )}

      {/* Update Other Layers trigger hidden for now — we may bring the
          cross-layer sync surface back later. Gated on `false` instead
          of deleted so the LayerUpdateTray, onOpenUpdateTray plumbing,
          and sync action routes stay wired and ready to re-enable by
          flipping this flag. */}
      {false && hasSource && (
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

/* ============================================ */
/* ========== PARTNER DRAFT PICKER ============= */
/* ============================================ */
//
// Phase 2 collab. Read-only dropdown of the partner's drafts for a
// given layer. Tap a draft to preview its content in a bottom sheet.
// Preview sheet has a "Copy to my side" CTA that clones the partner's
// draft into a new draft in the viewer's own pool (and activates it).
//
// Mounted alongside the user's own LayerDraftPicker inside LayerBar
// when PartnerStoryContext provides a partnerStory. Hidden entirely
// for solo projects (context value is undefined).

type AnyLayerDraft =
  | ConceptLayerDraft
  | CharactersLayerDraft
  | StoryLayerDraft
  | ScriptLayerDraft;

function getLayerPool(s: Story, layer: LayerKey): AnyLayerDraft[] {
  return (
    layer === "concept"    ? s.conceptDrafts :
    layer === "characters" ? s.charactersDrafts :
    layer === "story"      ? s.storyDrafts :
                             s.scriptDrafts
  );
}

function PartnerDraftPicker({
  layer,
  label,
  myStory,
  setStory,
  partnerStory,
}: {
  layer: LayerKey;
  label: string;
  myStory: Story;
  setStory: (u: (s: Story) => Story) => void;
  partnerStory: Story;
}) {
  const [open, setOpen] = useState(false);
  const [previewDraft, setPreviewDraft] = useState<AnyLayerDraft | null>(null);

  const pool = getLayerPool(partnerStory, layer);
  const sorted = [...pool].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // Dropdown broadcast/receive — joins the same mutual-exclusion bus
  // as the user's own LayerDraftPicker so only one list is open at a
  // time. Tag is layer-scoped with a "partner:" prefix so opening the
  // partner's concept picker doesn't close the user's concept picker
  // (we intentionally keep both independently toggleable within a
  // single layer bar? Actually no — same mutual exclusion is cleaner.
  // Use a distinct tag per picker).
  const busTag = `partner:${layer}`;
  useEffect(() => {
    if (open) {
      window.dispatchEvent(
        new CustomEvent("draft-dropdown:open", { detail: busTag }),
      );
    }
    const onOther = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== busTag) setOpen(false);
    };
    window.addEventListener("draft-dropdown:open", onOther);
    return () => window.removeEventListener("draft-dropdown:open", onOther);
  }, [open, busTag]);

  function handleCopyToMine(draft: AnyLayerDraft) {
    setStory(s => copyPartnerLayerDraft(s, draft, layer));
    setPreviewDraft(null);
    setOpen(false);
  }

  // Mirror the user's trigger: "{Label} Draft {N}" where N is the
  // partner's ACTIVE draft number for this layer (i.e., the one they'd
  // be viewing on their own screen). Falls back to the most-recently
  // -updated draft's number if the partner's active project draft
  // references a missing layer id.
  const partnerPd = partnerStory.projectDrafts.find(
    pd => pd.id === partnerStory.activeProjectDraftId,
  ) ?? partnerStory.projectDrafts[0];
  const partnerActiveId = partnerPd ? (
    layer === "concept"    ? partnerPd.conceptDraftId :
    layer === "characters" ? partnerPd.charactersDraftId :
    layer === "story"      ? partnerPd.storyDraftId :
                             partnerPd.scriptDraftId
  ) : undefined;
  const partnerActive = pool.find(d => d.id === partnerActiveId) ?? sorted[0];
  const activeNumber = partnerActive?.number ?? 1;
  const { partnerEmail } = usePartnerIdentity();

  return (
    <>
      <button
        className="layer-draft-trigger partner-draft-trigger"
        onClick={() => setOpen(v => !v)}
        aria-label={`Partner's ${label} drafts`}
        title={`Partner's ${label} drafts`}
      >
        <span className="partner-avatar-chip" aria-hidden="true">
          {initialFor(partnerEmail)}
        </span>
        <span className="layer-draft-label">{label} Draft {activeNumber}</span>
        <img src="/caret-sm.svg" alt="" className={`drafts-caret ${open ? "open" : ""}`} />
      </button>

      {typeof document !== "undefined" && createPortal(
        <>
          <div
            className={`sheet-backdrop ${open ? "open" : ""}`}
            onClick={() => setOpen(false)}
          />
          <div className={`sheet draft-sheet ${open ? "open" : ""}`}>
            <div className="sheet-handle" />
            <div className="draft-sheet-title">Partner's {label} Drafts</div>
            <div className="sheet-body">
              {sorted.length === 0 && (
                <div className="caption" style={{ padding: "16px 4px" }}>
                  Your partner hasn't created any {label.toLowerCase()} drafts yet.
                </div>
              )}
              {sorted.map(d => {
                const date = new Date(d.updatedAt);
                const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <button
                    key={d.id}
                    className="drafts-dropdown-item"
                    onClick={() => setPreviewDraft(d)}
                  >
                    <span>Draft {d.number}</span>
                    <span className="drafts-dropdown-date">{dateStr}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body,
      )}

      <PartnerDraftPreviewSheet
        draft={previewDraft}
        layer={layer}
        label={label}
        onClose={() => setPreviewDraft(null)}
        onCopyToMine={handleCopyToMine}
      />
    </>
  );
}

// ── Partner draft preview sheet ──
// Bottom sheet that shows a compact read-only view of the partner's
// selected draft, with a primary "Copy to my side" CTA at the bottom.
// Renders layer-specific content: logline/summary/tone/themes for
// Concept, character list for Characters, beats for Story, scene
// headings for Script. Editing is not possible here — to work on
// the content, the user taps "Copy to my side" which clones it into
// their own pool as an editable new draft.

function PartnerDraftPreviewSheet({
  draft,
  layer,
  label,
  onClose,
  onCopyToMine,
}: {
  draft: AnyLayerDraft | null;
  layer: LayerKey;
  label: string;
  onClose: () => void;
  onCopyToMine: (draft: AnyLayerDraft) => void;
}) {
  const open = !!draft;
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        className={`sheet-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
      />
      <div className={`sheet partner-preview-sheet ${open ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="draft-sheet-title">
          Partner's {label} Draft {draft?.number ?? ""}
        </div>
        <div className="sheet-body partner-preview-body">
          {draft && <PartnerDraftPreviewContent draft={draft} layer={layer} />}
        </div>
        <div className="sheet-sticky-footer">
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => { if (draft) onCopyToMine(draft); }}
          >
            Copy to my side
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ============================================ */
/* ====== PARTNER PROJECT DRAFT TRIGGER ======== */
/* ============================================ */
//
// Mirror of the user's project-drafts trigger, shown under the
// project title when the project is shared. Displays the partner's
// ACTIVE project-draft number (i.e., the one they'd be viewing on
// their own screen). Tapping opens a read-only sheet listing all
// their project drafts — no switch/new/duplicate actions, since a
// project draft is just a combination of layer-draft IDs from the
// partner's pool and switching to it here would be meaningless
// (those IDs don't exist in the user's own pool).

function PartnerProjectDraftTrigger({
  partnerStory,
  partnerEmail,
}: {
  partnerStory: Story;
  partnerEmail?: string;
}) {
  const [open, setOpen] = useState(false);
  const activePD = partnerStory.projectDrafts.find(
    pd => pd.id === partnerStory.activeProjectDraftId,
  ) ?? partnerStory.projectDrafts[0];
  const sorted = [...partnerStory.projectDrafts].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // Join the mutual-exclusion bus with a partner-scoped tag.
  const busTag = "partner:project";
  useEffect(() => {
    if (open) {
      window.dispatchEvent(
        new CustomEvent("draft-dropdown:open", { detail: busTag }),
      );
    }
    const onOther = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== busTag) setOpen(false);
    };
    window.addEventListener("draft-dropdown:open", onOther);
    return () => window.removeEventListener("draft-dropdown:open", onOther);
  }, [open, busTag]);

  return (
    <>
      <button
        className="drafts-dropdown-trigger"
        onClick={() => setOpen(v => !v)}
        aria-label="Partner's project drafts"
        title="Partner's project drafts"
      >
        <span className="partner-avatar-chip" aria-hidden="true">
          {initialFor(partnerEmail)}
        </span>
        <span>Draft {activePD?.number ?? 1}</span>
        <img src="/caret-sm.svg" alt="" className={`drafts-caret ${open ? "open" : ""}`} />
      </button>

      {typeof document !== "undefined" && createPortal(
        <>
          <div
            className={`sheet-backdrop ${open ? "open" : ""}`}
            onClick={() => setOpen(false)}
          />
          <div className={`sheet draft-sheet ${open ? "open" : ""}`}>
            <div className="sheet-handle" />
            <div className="draft-sheet-title">Partner's Project Drafts</div>
            <div className="sheet-body">
              {sorted.length === 0 && (
                <div className="caption" style={{ padding: "16px 4px" }}>
                  Your partner hasn't created any project drafts yet.
                </div>
              )}
              {sorted.map(pd => {
                const isActive = pd.id === partnerStory.activeProjectDraftId;
                const date = new Date(pd.updatedAt);
                const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div
                    key={pd.id}
                    className={`drafts-dropdown-item ${isActive ? "active" : ""}`}
                    style={{ cursor: "default" }}
                  >
                    <span>Project Draft {pd.number}</span>
                    <span className="drafts-dropdown-date">{dateStr}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function PartnerDraftPreviewContent({
  draft,
  layer,
}: {
  draft: AnyLayerDraft;
  layer: LayerKey;
}) {
  if (layer === "concept") {
    const d = draft as ConceptLayerDraft;
    return (
      <div className="partner-preview-content">
        {d.logline && (
          <div className="partner-preview-section">
            <div className="partner-preview-label">Logline</div>
            <div className="partner-preview-text">{d.logline}</div>
          </div>
        )}
        {d.concept.summary && (
          <div className="partner-preview-section">
            <div className="partner-preview-label">Summary</div>
            <div className="partner-preview-text">{d.concept.summary}</div>
          </div>
        )}
        {d.concept.tone && (
          <div className="partner-preview-section">
            <div className="partner-preview-label">Tone</div>
            <div className="partner-preview-text">{d.concept.tone}</div>
          </div>
        )}
        {d.concept.themes.length > 0 && (
          <div className="partner-preview-section">
            <div className="partner-preview-label">Themes</div>
            <div className="partner-preview-text">{d.concept.themes.join(", ")}</div>
          </div>
        )}
        {d.settings.genres.length > 0 && (
          <div className="partner-preview-section">
            <div className="partner-preview-label">Genres</div>
            <div className="partner-preview-text">{d.settings.genres.join(", ")}</div>
          </div>
        )}
        {!d.logline && !d.concept.summary && !d.concept.tone && d.concept.themes.length === 0 && (
          <div className="caption">This draft is empty.</div>
        )}
      </div>
    );
  }
  if (layer === "characters") {
    const d = draft as CharactersLayerDraft;
    if (d.characters.length === 0) {
      return <div className="caption">No characters in this draft yet.</div>;
    }
    return (
      <div className="partner-preview-content">
        {d.characters.map(c => (
          <div key={c.id} className="partner-preview-section">
            <div className="partner-preview-label">{c.name || "Unnamed"}</div>
            {c.archetype && <div className="partner-preview-text"><em>{c.archetype}</em></div>}
            {c.want && <div className="partner-preview-text"><strong>Want:</strong> {c.want}</div>}
            {c.need && <div className="partner-preview-text"><strong>Need:</strong> {c.need}</div>}
            {c.backstory && <div className="partner-preview-text">{c.backstory}</div>}
          </div>
        ))}
      </div>
    );
  }
  if (layer === "story") {
    const d = draft as StoryLayerDraft;
    if (d.beats.length === 0 && (!d.episodes || d.episodes.length === 0)) {
      return <div className="caption">No beats in this draft yet.</div>;
    }
    return (
      <div className="partner-preview-content">
        {d.beats.map((b: any, i: number) => (
          <div key={i} className="partner-preview-section">
            <div className="partner-preview-label">
              {b.title || `Beat ${i + 1}`}
            </div>
            {b.summary && <div className="partner-preview-text">{b.summary}</div>}
          </div>
        ))}
      </div>
    );
  }
  // script
  const d = draft as ScriptLayerDraft;
  if (d.script.scenes.length === 0) {
    return <div className="caption">No scenes in this draft yet.</div>;
  }
  return (
    <div className="partner-preview-content">
      {d.script.scenes.map((s: any, i: number) => (
        <div key={s.id ?? i} className="partner-preview-section">
          <div className="partner-preview-label">{s.heading || `Scene ${i + 1}`}</div>
          {s.content && (
            <div className="partner-preview-text" style={{ whiteSpace: "pre-wrap" }}>
              {s.content.length > 400 ? s.content.slice(0, 400) + "…" : s.content}
            </div>
          )}
        </div>
      ))}
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

/** Pull `replacement` out of whatever the model returned. Handles:
 *   - plain JSON body: `{"replacement":"..."}`
 *   - JSON wrapped in ```json fences
 *   - surrounding prose before/after the JSON object
 *  Returns null if nothing usable is found. */
function parseReplacement(raw: string): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/```json\s*|\s*```/g, "").trim();
  // Try a direct parse first — fastest path.
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed.replacement === "string") {
      return parsed.replacement;
    }
  } catch {
    /* fall through to regex extraction */
  }
  // Fallback: find the first { ... } that contains a replacement key.
  const match = stripped.match(/\{[\s\S]*?"replacement"\s*:\s*"([\s\S]*?)"\s*[},]/);
  if (match && match[1]) {
    // Un-escape the captured JSON string payload.
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return match[1];
    }
  }
  return null;
}

/** Replace the first occurrence of `needle` inside `haystack` with
 *  `replacement`. Uses indexOf (not a regex) so the needle's special
 *  characters stay literal. Returns haystack unchanged if not found. */
function replaceFirst(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  const idx = haystack.indexOf(needle);
  if (idx < 0) return haystack;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

/** Single committed highlight range. Phase 1: purely UI state — we
 *  don't yet act on it. Phases 2/3 will surface the "Change with AI"
 *  CTA + composer + wire the AI rewrite. */
interface ReadThroughHighlight {
  sceneId: string;
  text: string;
  /** Rects are in viewport coordinates; we translate to overlay-local
   *  coords at render time so page scroll doesn't drift them. */
  rects: Array<{ top: number; left: number; width: number; height: number }>;
}

function ReadThroughSheet({
  open,
  story,
  setStory,
  onClose,
}: {
  open: boolean;
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
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

  // ── Highlighter mode ────────────────────────────────────────────
  // When on: native selection is disabled on the body, pointer events
  // drive a custom Range whose rects we paint in yellow. Designed to
  // feel like a physical marker — no blue selection handles, no copy
  // menu, one drag = one highlight.
  const [highlightMode, setHighlightMode] = useState(false);
  const [activeHighlight, setActiveHighlight] =
    useState<ReadThroughHighlight | null>(null);
  // Live drag preview — separate from the committed `activeHighlight`
  // so the visual follows the finger without repeatedly overwriting
  // the saved range until pointerup.
  const [dragRects, setDragRects] = useState<
    ReadThroughHighlight["rects"] | null
  >(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Clear any existing highlight when the sheet is closed or the user
  // toggles highlight mode off.
  useEffect(() => {
    if (!open || !highlightMode) {
      setActiveHighlight(null);
      setDragRects(null);
    }
  }, [open, highlightMode]);

  // ── Composer (Phase 2) ─────────────────────────────────────────
  // Opens when the user taps "Change with AI" on a committed
  // highlight. Shows a small preview of the selected text and a
  // one-line input for the AI prompt. Positioned fixed above the
  // keyboard via visualViewport so the read-through sheet stays
  // visible behind it.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInstruction, setComposerInstruction] = useState("");
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  // Mirror of composerOpen, read inside the selectionchange listener
  // so we know to preserve activeHighlight when iOS collapses the
  // body selection on focus move to the composer input.
  const composerOpenRef = useRef(false);
  useEffect(() => {
    composerOpenRef.current = composerOpen;
  }, [composerOpen]);

  // Track the iOS soft-keyboard via visualViewport. The gap between
  // the visual viewport bottom and the layout viewport bottom IS the
  // keyboard height; we use it to pin the composer flush above it.
  useEffect(() => {
    if (!composerOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const gap = window.innerHeight - (vv.height + vv.offsetTop);
      setKeyboardBottomInset(Math.max(0, gap));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [composerOpen]);

  // Reset composer state whenever we open or close it.
  useEffect(() => {
    if (composerOpen) {
      setComposerInstruction("");
      setComposerError(null);
      // Defer focus a frame so iOS brings up the keyboard after the
      // element is fully rendered.
      const id = window.setTimeout(() => {
        composerInputRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(id);
    } else {
      setKeyboardBottomInset(0);
    }
  }, [composerOpen]);

  async function submitComposer() {
    if (!activeHighlight || composerBusy) return;
    const instruction = composerInstruction.trim();
    if (!instruction) return;
    setComposerBusy(true);
    setComposerError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story,
          action: {
            type: "rewrite_highlighted_range",
            payload: {
              sceneId: activeHighlight.sceneId,
              selectedText: activeHighlight.text,
              instruction,
            },
          },
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(`/api/generate ${res.status}: ${body || "(no body)"}`);
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
            if (msg.type === "text") fullText += msg.value;
          } catch {
            /* ignore */
          }
        }
      }
      // Extract { "replacement": "..." } from the JSON body.
      const replacement = parseReplacement(fullText);
      if (!replacement) {
        throw new Error("AI returned no replacement text.");
      }
      // Splice into the scene. We replace the FIRST occurrence of the
      // selected text — in practice the highlighted text is unlikely
      // to appear verbatim twice in one scene. If it does, the first
      // match wins; users can re-run the highlighter on the second
      // instance.
      const sid = activeHighlight.sceneId;
      const needle = activeHighlight.text;
      setStory((s) => {
        const draft = getActiveScriptDraft(s);
        const scenes = draft.script.scenes.map((sc) =>
          sc.id === sid
            ? { ...sc, content: replaceFirst(sc.content, needle, replacement) }
            : sc,
        );
        return updateScriptDraft(s, {
          script: { ...draft.script, scenes },
        });
      });
      // Close composer, clear the highlight, exit highlight mode —
      // a clean landing so the user sees their change immediately.
      setComposerOpen(false);
      setActiveHighlight(null);
      setHighlightMode(false);
    } catch (e) {
      setComposerError(
        e instanceof Error ? e.message : "Something went wrong.",
      );
    } finally {
      setComposerBusy(false);
    }
  }

  /** Walk up the DOM until we find the scene container element (the
   *  one bearing `data-scene-id`). Returns the id, or null if the
   *  caret isn't inside any scene (e.g. on a gap between scenes). */
  function sceneIdForNode(node: Node): string | null {
    let el: Node | null = node;
    while (el) {
      if (el instanceof HTMLElement && el.dataset.sceneId) {
        return el.dataset.sceneId;
      }
      el = el.parentNode;
    }
    return null;
  }

  /** Convert viewport-space rects to overlay-local rects by subtracting
   *  the body container's bounding rect (overlay is positioned in
   *  the body's coordinate space via `position: absolute`). */
  function toLocalRects(rects: DOMRect[]): ReadThroughHighlight["rects"] {
    const host = bodyRef.current;
    if (!host) return [];
    const base = host.getBoundingClientRect();
    return rects.map((r) => ({
      top: r.top - base.top + host.scrollTop,
      left: r.left - base.left + host.scrollLeft,
      width: r.width,
      height: r.height,
    }));
  }

  // Native-selection-driven highlighter. Instead of tracking pointers
  // ourselves (which fights iOS Safari's touch gesture recogniser in
  // subtle and hard-to-reproduce ways), we enable native text selection
  // in CSS and simply observe `selectionchange`. Whenever the user has
  // a non-empty selection inside our read-through body we compute its
  // rects and render them as our yellow overlay. On iOS this means the
  // gesture is exactly the native "long-press then drag" — the most
  // reliable selection gesture the OS knows how to do.
  //
  // After the user's selection has been stable for a short debounce
  // window, we clear the native Selection entirely. The yellow rects
  // stay (they're just React state) but iOS has nothing left to paint
  // blue on top of — this side-steps the iOS-specific quirks around
  // `::selection { background: transparent }` not being respected in
  // every case. Refs coordinate so our own clear doesn't re-enter
  // the handler and wipe activeHighlight.
  const commitTimerRef = useRef<number | null>(null);
  const weClearedSelectionRef = useRef(false);
  useEffect(() => {
    if (!highlightMode) {
      // Leaving highlight mode clears everything and also drops any
      // lingering native selection so the blue handles don't stick.
      setActiveHighlight(null);
      setDragRects(null);
      window.getSelection?.()?.removeAllRanges?.();
      if (commitTimerRef.current != null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      return;
    }
    const el = bodyRef.current;
    if (!el) return;

    const onSelChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        // If WE cleared the selection (to suppress the iOS blue),
        // this collapse is our own doing — drop the flag and
        // bail without touching activeHighlight or dragRects.
        if (weClearedSelectionRef.current) {
          weClearedSelectionRef.current = false;
          return;
        }
        // Otherwise: user tapped elsewhere. Clear drag rects, and
        // clear activeHighlight UNLESS the composer is open. Focusing
        // the composer input collapses the body selection; wiping
        // activeHighlight there would unmount the composer (gated
        // on composerOpen && activeHighlight). Read composerOpen via
        // a ref so this listener doesn't re-subscribe on each flip.
        setDragRects(null);
        if (!composerOpenRef.current) {
          setActiveHighlight(null);
        }
        return;
      }
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      if (!anchor || !focus) return;
      // Scope: both endpoints must be inside our read-through body.
      if (!el.contains(anchor) || !el.contains(focus)) return;
      const anchorSceneId = sceneIdForNode(anchor);
      if (!anchorSceneId) return;
      const focusSceneId = sceneIdForNode(focus);

      let useRange: Range;
      if (focusSceneId === anchorSceneId) {
        useRange = sel.getRangeAt(0).cloneRange();
      } else {
        // Cross-scene drag: clamp to the anchor's scene so one
        // highlight never spans two scenes. Walk to the last text
        // node inside the anchor's scene and end there.
        const sceneEl = el.querySelector<HTMLElement>(
          `[data-scene-id="${anchorSceneId}"]`,
        );
        if (!sceneEl) return;
        const walker = document.createTreeWalker(
          sceneEl,
          NodeFilter.SHOW_TEXT,
        );
        let last: Text | null = null;
        while (walker.nextNode()) last = walker.currentNode as Text;
        if (!last) return;
        useRange = document.createRange();
        try {
          useRange.setStart(anchor, sel.anchorOffset);
          useRange.setEnd(last, last.length);
        } catch {
          return;
        }
      }
      const text = useRange.toString();
      if (text.trim().length < 2) {
        setDragRects(null);
        return;
      }
      const localRects = toLocalRects(Array.from(useRange.getClientRects()));
      setDragRects(localRects);
      setActiveHighlight({
        sceneId: anchorSceneId,
        text,
        rects: localRects,
      });
      // Debounced "commit": after the selection has been stable for
      // ~350ms (i.e. the user's finger is up), remove the native
      // Selection so the blue highlight disappears. The yellow rects
      // we just set above are independent React state and stay put.
      // On iOS this is the only reliable way to guarantee no blue —
      // some versions silently ignore `::selection { background:
      // transparent }`, so we nuke the selection altogether.
      if (commitTimerRef.current != null) {
        window.clearTimeout(commitTimerRef.current);
      }
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        const s = window.getSelection();
        if (!s || s.isCollapsed) return;
        weClearedSelectionRef.current = true;
        s.removeAllRanges();
      }, 350);
    };

    document.addEventListener("selectionchange", onSelChange);
    return () => {
      document.removeEventListener("selectionchange", onSelChange);
      if (commitTimerRef.current != null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMode]);

  // Re-measure the committed highlight on scroll so the yellow layer
  // stays pinned to its text. We can't rebuild the Range (we don't
  // retain the DOM Range object), so we convert the cached viewport
  // rects once on commit and rely on them being anchored in the
  // scrollable container's coordinate space (top already includes
  // scrollTop). Stored rects stay valid as long as the layout doesn't
  // reflow — which, for this sheet, only happens on draft changes.
  // No additional work needed here.

  const rectsToShow = dragRects ?? activeHighlight?.rects ?? null;

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
              {highlightMode
                ? "Drag over any passage to highlight it"
                : `${scenes.length} scene${scenes.length === 1 ? "" : "s"}`}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                className={`read-through-hl-toggle ${highlightMode ? "active" : ""}`}
                onClick={() => setHighlightMode((v) => !v)}
                aria-pressed={highlightMode}
                aria-label={highlightMode ? "Exit highlighter" : "Highlight text"}
              >
                <span className="read-through-hl-swatch" aria-hidden />
                <span>{highlightMode ? "Done" : "Highlight"}</span>
              </button>
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
          </div>
        )}
        <div
          ref={bodyRef}
          className={`sheet-body read-through-body ${
            highlightMode ? "highlighting" : ""
          }`}
        >
          {/* Yellow highlight overlay — rendered first so z-index keeps
              it behind the text via CSS (pointer-events: none on the
              rects so drags continue to hit the text underneath). */}
          {rectsToShow && rectsToShow.length > 0 && (
            <div className="read-through-hl-layer" aria-hidden>
              {rectsToShow.map((r, i) => (
                <div
                  key={i}
                  className="read-through-hl-rect"
                  style={{
                    top: r.top,
                    left: r.left,
                    width: r.width,
                    height: r.height,
                  }}
                />
              ))}
            </div>
          )}
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
        {/* Floating "Change with AI" CTA — appears only when a highlight
            is committed and the composer isn't already open. Pinned to
            the bottom of the sheet, centered. */}
        {activeHighlight && !composerOpen && (
          <button
            type="button"
            className="read-through-hl-cta"
            /* On iOS, tapping a button can steal focus from the
               selection and collapse it. preventDefault on the
               pressing event keeps the native selection (and our
               `activeHighlight` state) intact until onClick fires. */
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={() => setComposerOpen(true)}
          >
            Change with AI
          </button>
        )}
      </div>
      {/* Composer overlay — a second surface above the sheet. Backdrop
          is semi-transparent and ONLY closes the composer (not the
          read-through sheet behind it). Positioned with bottom pinned
          to the keyboard top via visualViewport. */}
      {composerOpen && activeHighlight && (
        <>
          <div
            className="read-through-composer-backdrop"
            onClick={() => {
              if (!composerBusy) setComposerOpen(false);
            }}
          />
          <div
            className="read-through-composer"
            style={{ bottom: keyboardBottomInset }}
          >
            <div className="read-through-composer-preview">
              <span className="read-through-composer-preview-label">Selected</span>
              <span className="read-through-composer-preview-text">
                {activeHighlight.text.length > 140
                  ? activeHighlight.text.slice(0, 140).trimEnd() + "…"
                  : activeHighlight.text}
              </span>
            </div>
            <div className="read-through-composer-row">
              <input
                ref={composerInputRef}
                type="text"
                className="read-through-composer-input"
                placeholder="What should change?"
                value={composerInstruction}
                onChange={(e) => setComposerInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitComposer();
                  }
                  if (e.key === "Escape") {
                    if (!composerBusy) setComposerOpen(false);
                  }
                }}
                disabled={composerBusy}
                autoCapitalize="sentences"
                autoCorrect="on"
              />
              <button
                type="button"
                className="read-through-composer-cancel"
                onClick={() => setComposerOpen(false)}
                disabled={composerBusy}
                aria-label="Cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="read-through-composer-submit"
                onClick={submitComposer}
                disabled={composerBusy || !composerInstruction.trim()}
              >
                {composerBusy ? "…" : "Rewrite"}
              </button>
            </div>
            {composerError && (
              <div className="read-through-composer-error" role="alert">
                {composerError}
              </div>
            )}
          </div>
        </>
      )}
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
    <div className="read-through-scene" data-scene-id={scene.id}>
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
  copyAction,
  readOnly,
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
  /** When set, renders a small copy button after the label — used by
   *  partner-preview mode to cherry-pick individual fields from the
   *  partner's concept draft into the user's own active draft. */
  copyAction?: () => void;
  /** Read-only preview rendering (partner-preview mode). When the row
   *  has no values, shows "None added" instead of the placeholder and
   *  hides the caret — there's nothing to expand into. Rows that DO
   *  have values still render normally so the user can see partner's
   *  content; the surrounding `.partner-preview-locked` wrapper stops
   *  clicks from actually toggling anything. */
  readOnly?: boolean;
}) {
  const hasValues = values && values.length > 0;
  const suppressControls = readOnly && !hasValues;
  return (
    <div className="attr-row">
      <button
        className="attr-row-header"
        onClick={onToggle}
        disabled={suppressControls}
      >
        <span className="attr-label">
          {label}
          {/* AI wand hidden in readOnly (partner-preview) rows —
              there's nothing to generate into someone else's draft. */}
          {ai && !readOnly && <AIWandButton onClick={ai} loading={!!aiLoading} />}
          {copyAction && (
            <button
              type="button"
              className="partner-copy-field-btn"
              title="Copy this from partner's draft"
              aria-label="Copy this field from partner's draft"
              onClick={(e) => { e.stopPropagation(); copyAction(); }}
            >
              <CopyGlyph />
            </button>
          )}
          {dot && <span className="sync-dot attr-dot" />}
        </span>
        <div className="attr-values">
          {hasValues
            ? values.map(v => <span key={v} className="attr-pill">{v}</span>)
            : <span className="attr-placeholder">{readOnly ? "None added" : (placeholder || "Not set")}</span>
          }
        </div>
        {/* Caret hidden in partner-preview (readOnly) mode entirely —
            the user can't interact with the tab anyway (the wrapper
            .partner-preview-locked has pointer-events: none), so an
            expand indicator is misleading. Previously we only hid it
            on empty rows via `suppressControls`; user asked to pull
            it from ALL concept rows while previewing a partner draft. */}
        {!readOnly && !suppressControls && (
          <svg className={`attr-caret ${expanded ? "open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        )}
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

/* ── Unified empty-state for Characters / Story / Script tabs.
 *    Lives on the plain gray background (no card). Icon + title +
 *    caption + two side-by-side buttons: "Add X" (secondary) and
 *    "Create everything for me" (primary AI). Used everywhere so a
 *    fresh user sees the same choice on every layer. */
function EmptyLayerState({
  icon,
  title,
  caption,
  addLabel,
  onAdd,
  onGenerate,
  generating,
  generateLabel = "Create all",
  generatingLabel = "Creating…",
}: {
  icon: React.ReactNode;
  title: string;
  caption: string;
  /** When omitted, no "Add X" button renders. Script's empty state
   *  uses this to show a pure info card (icon + title + caption). */
  addLabel?: string;
  onAdd?: () => void;
  /** When omitted, no "Create/Write all" button renders. Same rule
   *  as `onAdd` — used by Script's minimal empty state. */
  onGenerate?: () => void;
  generating?: boolean;
  /** Primary-button label. Defaults to "Create all"; Story tab
   *  passes "Write all" since its AI action produces prose rather
   *  than inventing new entities from scratch. */
  generateLabel?: string;
  /** In-flight label shown while `generating` is true. Defaults
   *  to "Creating…"; Story passes "Writing…" to match. */
  generatingLabel?: string;
}) {
  const hasActions = !!onAdd || !!onGenerate;
  return (
    <div className="empty-layer-state">
      <div className="empty-layer-icon">{icon}</div>
      <div className="empty-layer-title">{title}</div>
      <div className="empty-layer-caption">{caption}</div>
      {/* Stacked (primary / secondary) compact CTAs — the sticky bar
          that appears post-first-item keeps the larger, single-button
          treatment; the empty state uses a quieter pair so the icon +
          copy stay the focal point of the first-paint surface.
          Hidden entirely if no onAdd + no onGenerate were passed, for
          tabs (like Script) that intentionally keep the empty state
          informational-only. */}
      {hasActions && (
        <div className="empty-layer-actions">
          {onAdd && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onAdd}
              disabled={!!generating}
              icon={<span style={{ fontSize: 14, lineHeight: 1 }}>+</span>}
            >
              {addLabel}
            </Button>
          )}
          {onGenerate && (
            <Button
              variant="primary"
              size="sm"
              onClick={onGenerate}
              disabled={!!generating}
              icon={<AISparkleIcon />}
              className="empty-state-ai-btn"
            >
              {generating ? generatingLabel : generateLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sticky bottom action bar for Characters / Story / Script.
 *    Mounts (and animates up) only once the layer has at least one
 *    item, matching the rule that it shouldn't appear on empty tabs
 *    (the empty-state card owns those CTAs instead). Pinned flush to
 *    the bottom of the viewport; adds a spacer into the scroll flow
 *    so the last list row isn't obscured.
 *
 *    Portaled to `document.body` so it stacks cleanly with the
 *    portaled draft sheets — inside `.studio-scroll`, the Safari
 *    `-webkit-overflow-scrolling: touch` compositing layer was
 *    trapping this bar and letting it paint above the sheet
 *    backdrop regardless of z-index. Rendering at body level makes
 *    the z:15 sticky-bar ↔ z:40/50 sheet stacking behave normally. */
function LayerStickyBar({
  label,
  onClick,
  disabled,
  icon,
}: {
  /** Single primary CTA label — Characters passes "Add character",
   *  Story passes "Write scene", Script passes "Write all". Whatever
   *  the verb, the button is always styled black/primary for a
   *  consistent "commit your intent for this tab" affordance. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Optional leading glyph — Characters uses "+" on its add-button
   *  for a recognizable "new item" cue. Other tabs generally pass no
   *  icon because their actions aren't additive. */
  icon?: React.ReactNode;
}) {
  const bar = (
    <div className="layer-sticky-bar">
      <Button
        variant="primary"
        size="lg"
        onClick={onClick}
        disabled={!!disabled}
        icon={icon}
        style={{ flex: 1 }}
      >
        {label}
      </Button>
    </div>
  );
  if (typeof document === "undefined") return null;
  return createPortal(bar, document.body);
}

/* ── AI sparkle glyph — standalone SVG for buttons that trigger
 *    full-layer generation ("Create everything for me"). Scaled a
 *    touch larger than the wand so it reads as a peer to the button
 *    label rather than a tucked-in corner ornament. */
function AISparkleIcon() {
  return (
    <svg
      viewBox="0 0 100 110"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      style={{ flex: "0 0 auto" }}
    >
      <path d="m41.785 60.52h-13.055c-0.52344-0.0078-1.0547-0.14844-1.5352-0.43359-1.4141-0.84766-1.8789-2.6836-1.0273-4.1016l31.906-53.211c0.60547-1.0117 1.7852-1.6094 3.0195-1.4141 1.6289 0.25391 2.7461 1.7773 2.4961 3.4102l-5.375 34.715h13.055c0.52344 0.0078 1.0547 0.14844 1.5352 0.43359 1.4141 0.84766 1.8789 2.6836 1.0273 4.1016l-31.906 53.211c-0.60547 1.0117-1.7852 1.6094-3.0195 1.4141-1.6289-0.25391-2.7461-1.7773-2.4961-3.4102z" />
    </svg>
  );
}

/* ── AI wand button — elegant sparkle, sits next to field labels ── */
/* Tiny copy glyph used by partner-preview per-item copy buttons.
 * Two overlapping rounded rectangles — the standard "copy" metaphor. */
function CopyGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

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
  copyAction,
  readOnly,
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
  /** Same as AttrRow.copyAction — partner-preview per-field copy. */
  copyAction?: () => void;
  /** Partner-preview rendering. When the field is empty, shows
   *  "None added" instead of the placeholder and hides the caret, and
   *  the collapsed header is no longer clickable. Rows with content
   *  render normally. */
  readOnly?: boolean;
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

  const copyBtn = copyAction ? (
    <button
      type="button"
      className="partner-copy-field-btn"
      title="Copy this from partner's draft"
      aria-label="Copy this field from partner's draft"
      onClick={(e) => { e.stopPropagation(); copyAction(); }}
    >
      <CopyGlyph />
    </button>
  ) : null;

  if (!isOpen) {
    // Collapsed branch only renders when the field is empty AND not
    // focused. In partner-preview (readOnly), the header becomes
    // non-interactive and shows "None added" — the caret is hidden
    // because there's nothing the user can do to expand the row.
    return (
      <div className="attr-row">
        <button
          className="attr-row-header"
          onClick={() => { if (!readOnly) setFocused(true); }}
          disabled={readOnly}
        >
          <span className="attr-label">
            {label}
            {/* AI wand + history pager hide in readOnly (partner-
                preview) mode — neither action makes sense against a
                draft the viewer can't write to. */}
            {ai && !readOnly && <AIWandButton onClick={ai} loading={!!aiLoading} />}
            {copyBtn}
            {speak}
            {dot && <span className="sync-dot attr-dot" />}
          </span>
          <div className="attr-values">
            <span className="attr-placeholder">{readOnly ? "None added" : placeholder}</span>
          </div>
          {!readOnly && pager}
          {!readOnly && (
            <svg className="attr-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          )}
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
          {/* Same readOnly rule as the collapsed branch above. */}
          {ai && !readOnly && <AIWandButton onClick={ai} loading={!!aiLoading} />}
          {copyBtn}
          {dot && <span className="sync-dot attr-dot" />}
        </span>
        {!readOnly && pager}
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
  // Partner-preview mode: expose per-field Copy buttons so the user can
  // pull individual concept fields (title, logline, tone, etc.) from
  // the partner's draft into their own active Concept draft, overwriting
  // the matching field if already populated.
  const { isPartnerPreviewing, onCopyPartnerConceptField } = usePartnerIdentity();
  const previewCopy = (field: ConceptCopyField): (() => void) | undefined =>
    isPartnerPreviewing && onCopyPartnerConceptField
      ? () => onCopyPartnerConceptField(field)
      : undefined;
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

  // Partner-preview empty-state detection.
  //
  // Title + genres are always set (required at project creation), so
  // "empty" here means the partner hasn't filled in any of the
  // downstream concept fields yet. When all of these are blank we
  // surface a small "nothing added" notice at the top of the tab so
  // the user isn't confused by a sea of "None added" rows.
  const partnerConceptEmpty =
    isPartnerPreviewing &&
    !d.logline.trim() &&
    !d.concept.summary.trim() &&
    !d.concept.tone.trim() &&
    d.concept.themes.length === 0 &&
    d.settings.endingTypes.length === 0 &&
    d.settings.references.length === 0 &&
    d.settings.writerStyles.length === 0 &&
    d.settings.subGenres.length === 0 &&
    !d.settings.framework;

  return (
    <>
      <LayerBar layer="concept" label="Concept" story={story} setStory={setStory} autosaveEnabled={autosaveEnabled} onOpenUpdateTray={onOpenUpdateTray} />

      {/* Partner-preview empty-state notice — appears when the partner
          hasn't filled any of the optional concept fields. The required
          title + genres still render below; this is context so the user
          understands why every other row says "None added". */}
      {partnerConceptEmpty && (
        <div className="partner-preview-empty-notice">
          Your partner hasn't added anything else to this draft yet.
        </div>
      )}

      {!isPartnerPreviewing && (
        <Tip id="concept-drafts-are-free">
          Save as many Concept drafts as you want — experiment freely. Your active draft is what the rest of the app reads.
        </Tip>
      )}

      {/* Format */}
      <AttrRow
        label="Format"
        values={[formatLabel.toUpperCase()]}
        expanded={openAttr === "format"}
        onToggle={() => toggle("format")}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "projectType")}
        copyAction={previewCopy("projectType")}
        readOnly={isPartnerPreviewing}
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

      {/* Title — sits directly below Format per spec so the two
          project-identity fields (format + title) cluster at the top
          of Concept, before the genre/tone/theme triage begins. */}
      <TextAttrRow
        label="Title"
        value={story.title}
        placeholder="Add a title"
        onChange={v => setStory(s => updateConceptDraft({ ...s, title: v }, {}))}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "title")}
        ai={() => generateConcept("title")}
        aiLoading={aiBusy === "title"}
        copyAction={previewCopy("title")}
        readOnly={isPartnerPreviewing}
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

      {/* Genre */}
      <AttrRow
        label="Genre"
        values={d.settings.genres.length > 0 ? d.settings.genres.map(g => g.toUpperCase()) : undefined}
        placeholder="Select genres"
        expanded={openAttr === "genre"}
        onToggle={() => toggle("genre")}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "genres")}
        copyAction={previewCopy("genres")}
        readOnly={isPartnerPreviewing}
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
            readOnly={isPartnerPreviewing}
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
        copyAction={previewCopy("references")}
        readOnly={isPartnerPreviewing}
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
          <span className="attr-label">
            Writer Style
            {previewCopy("writerStyles") && (
              <button
                type="button"
                className="partner-copy-field-btn"
                title="Copy this from partner's draft"
                aria-label="Copy writer style from partner's draft"
                onClick={(e) => { e.stopPropagation(); previewCopy("writerStyles")!(); }}
              >
                <CopyGlyph />
              </button>
            )}
          </span>
          <div className="attr-values">
            {d.settings.writerStyles.length > 0
              ? d.settings.writerStyles.map(w => (
                  <span key={w} className="attr-pill">{w.toUpperCase()}</span>
                ))
              : <span className="attr-placeholder">{isPartnerPreviewing ? "None added" : "Pick writers you want to echo"}</span>}
          </div>
        </div>
        {/* Hide the Select/Edit button when previewing the partner's
            concept draft — this row is read-only there, and the button
            would expose a sheet the user can't meaningfully act on. */}
        {!isPartnerPreviewing && (
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
        )}
      </div>

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
        copyAction={previewCopy("logline")}
        readOnly={isPartnerPreviewing}
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
        copyAction={previewCopy("summary")}
        readOnly={isPartnerPreviewing}
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
        copyAction={previewCopy("tone")}
        readOnly={isPartnerPreviewing}
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
        copyAction={previewCopy("themes")}
        readOnly={isPartnerPreviewing}
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
        readOnly={isPartnerPreviewing}
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
        copyAction={previewCopy("endingTypes")}
        readOnly={isPartnerPreviewing}
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
  runGenerateAll,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
  openNewCharacter: () => void;
  openCharacter: (id: string) => void;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
  /** Wrap a Create-all action with the Studio-level scrim + sheet-close
   *  choreography. See `runGenerateAll` in Studio. */
  runGenerateAll: (fn: () => Promise<void>) => Promise<void>;
}) {
  const d = getActiveCharactersDraft(story);
  const { profile } = useProfileCapture();
  // Partner-preview mode: when we're rendering the partner's characters
  // draft read-only, expose a per-card "copy to my draft" button so the
  // user can cherry-pick individual cast rows without wholesale cloning
  // the entire partner draft.
  const { isPartnerPreviewing, onCopyPartnerCharacter } = usePartnerIdentity();
  const previewActive = !!(isPartnerPreviewing && onCopyPartnerCharacter);

  // "Create all" — one-tap cast generation driven by the active Concept
  // draft. Uses the same cross-layer sync path the Update Other Layers
  // tray uses, but scoped to a single target so the empty-state
  // affordance is dead-simple. Runs inside runGenerateAll so the full
  // dark scrim + spinner is shown until the sync resolves.
  const [genBusy, setGenBusy] = useState(false);
  async function generateAllCharacters() {
    if (genBusy) return;
    setGenBusy(true);
    try {
      await runGenerateAll(async () => {
        const next = await syncLayer(story, "concept", "characters", profile);
        setStory(() => next);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") window.alert(msg);
    } finally {
      setGenBusy(false);
    }
  }

  const roleLabels: Record<string, string> = {
    protagonist: "Protagonist",
    antagonist: "Antagonist",
    supporting: "Supporting",
    mentor: "Mentor",
    love_interest: "Love Interest",
    comic_relief: "Comic Relief",
  };

  const hasCharacters = d.characters.length > 0;

  return (
    <>
      <LayerBar layer="characters" label="Characters" story={story} setStory={setStory} autosaveEnabled={autosaveEnabled} onOpenUpdateTray={onOpenUpdateTray} />

      {/* Top-of-content Tip — only surfaces after the user has added
          their first character. On an empty tab the EmptyLayerState
          below is already teaching the main move; a second teaching
          surface on top would clutter the first-paint view. */}
      {hasCharacters && (
        <Tip id="characters-distinct-voices" persist={false}>
          Give each character a distinct voice and clear want — it&apos;s what makes dialogue feel alive on the page.
        </Tip>
      )}

      {!hasCharacters && (
        <EmptyLayerState
          icon={<img src="/character-icon.svg" width={41} height={44} alt="" />}
          title="No characters yet"
          caption="Create your first character to bring your story to life."
          addLabel="Add character"
          onAdd={openNewCharacter}
          onGenerate={generateAllCharacters}
          generating={genBusy}
          generateLabel="Create all with AI"
          generatingLabel="Creating…"
        />
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
          {previewActive && (
            <button
              type="button"
              className="partner-copy-item-btn"
              title="Copy this character to my draft"
              aria-label="Copy this character to my draft"
              onClick={(e) => {
                e.stopPropagation();
                onCopyPartnerCharacter!(ch.id);
              }}
            >
              <CopyGlyph />
              <span>Copy</span>
            </button>
          )}
        </div>
      ))}

      {hasCharacters && (
        <>
          <div className="layer-sticky-bar-spacer" aria-hidden="true" />
          <LayerStickyBar
            label="Add character"
            onClick={openNewCharacter}
            disabled={genBusy}
            icon={<span style={{ fontSize: 14, lineHeight: 1 }}>+</span>}
          />
        </>
      )}
    </>
  );
}

/* ── Character edit form ── */

function CharacterEditForm({
  character: ch,
  story,
  onUpdate,
  onRemove,
  isNew = false,
}: {
  character: Character;
  story: Story;
  onUpdate: (patch: Partial<Character>) => void;
  onRemove: () => void;
  /** True when the sheet was opened via "New character" — hides the
   *  Delete-character button because the entity hasn't been saved
   *  yet. An unsaved blank character gets auto-discarded on sheet
   *  close, so there is literally nothing to delete. */
  isNew?: boolean;
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

      {/* Gender — chip selector. Four canonical buckets plus custom
          free-text (for genderfluid, agender, non-human characters,
          etc.). Optional: if the user leaves this blank, the sheet-
          close handler in Studio kicks off a name-based AI detection
          and fills it in. */}
      <div className="eyebrow" style={{ marginTop: 4 }}>Gender</div>
      <div className="chip-row">
        {([
          { key: "male",        label: "Male" },
          { key: "female",      label: "Female" },
          { key: "nonbinary",   label: "Non-binary" },
          { key: "unspecified", label: "Unspecified" },
        ] as const).map(g => (
          <Selector
            key={g.key}
            selected={ch.gender === g.key}
            onClick={() => onUpdate({ gender: ch.gender === g.key ? "" : g.key })}
          >
            {g.label}
          </Selector>
        ))}
        {/* Custom chip — when gender is set to something outside the
            canonical four, it renders here as a selected chip showing
            the actual value; tapping it clears the field (back to
            "not set"). Gives users a non-destructive way to see and
            remove a free-text value without a separate input field
            at this layout tier. */}
        {ch.gender && !["male","female","nonbinary","unspecified"].includes(ch.gender) && (
          <Selector
            selected
            onClick={() => onUpdate({ gender: "" })}
          >
            {ch.gender} &#10005;
          </Selector>
        )}
      </div>

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
          (sheet Save is sticky in the footer). Hidden in "New character"
          mode: the entity isn't saved yet, so there's nothing to delete —
          closing the sheet without filling anything auto-discards it. */}
      {!isNew && (
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
      )}
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
  runGenerateAll,
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
  /** Wrap a Create-all action with the Studio-level scrim + sheet-close
   *  choreography. See `runGenerateAll` in Studio. */
  runGenerateAll: (fn: () => Promise<void>) => Promise<void>;
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

  // "Create everything for me" — one-tap beat generation. Derives from
  // Characters if the cast is populated (richer source), otherwise falls
  // back to Concept so the button still works on a brand-new project.
  const { profile } = useProfileCapture();
  const [genBusy, setGenBusy] = useState(false);
  async function generateAllBeats() {
    if (genBusy) return;
    setGenBusy(true);
    try {
      await runGenerateAll(async () => {
        const source: LayerKey = isLayerDraftEmpty(story, "characters") ? "concept" : "characters";
        const next = await syncLayer(story, source, "story", profile);
        setStory(() => next);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") window.alert(msg);
    } finally {
      setGenBusy(false);
    }
  }

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

  const hasBeats = beats.length > 0;

  return (
    <>
      <LayerBar layer="story" label="Story" story={story} setStory={setStory} autosaveEnabled={autosaveEnabled} onOpenUpdateTray={onOpenUpdateTray} />

      {/* Top-of-content Tip — only surfaces once the user has added a
          first scene. The empty state carries its own teaching; a tip
          on top of that would double the noise at first paint. */}
      {hasBeats && (
        <Tip id="story-scenes-are-building-blocks" persist={false}>
          Scenes are the building blocks of your script — long-press any scene to drag and reorder.
        </Tip>
      )}

      <div className={draggingIdx != null ? "beats-dragging" : ""}>
        {!hasBeats && (
          <EmptyLayerState
            icon={<img src="/story-icon.svg" width={49} height={41} alt="" />}
            title="No scenes yet"
            caption="Start building your story structure — add your first scene."
            addLabel="Add scene"
            onAdd={() => openBeatTray(0)}
            onGenerate={generateAllBeats}
            generating={genBusy}
            generateLabel="Write all with AI"
            generatingLabel="Writing…"
          />
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
                    <div className="beat-name">{beat.name || "Untitled scene"}</div>
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
                    <div className="beat-section-label">Characters in this scene</div>
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
                  aria-label="Insert scene here"
                >
                  + Add scene
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {hasBeats && (
        <>
          <div className="layer-sticky-bar-spacer" aria-hidden="true" />
          <LayerStickyBar
            label="Add scene"
            onClick={() => openBeatTray(beats.length)}
            disabled={genBusy}
            icon={<span style={{ fontSize: 18, lineHeight: 1, fontWeight: 300 }}>+</span>}
          />
        </>
      )}
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
  moments,
  run,
  busy,
  autosaveEnabled = true,
  onOpenUpdateTray,
  onOpenReadThrough,
  onImportScript,
  importing,
  importStep,
  onAddScene,
  runGenerateAll,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  beats: Beat[];
  /** Forwarded from Studio so scene cards can render the moment text
   *  + type of everything the user linked in the Story tab. */
  moments: Moment[];
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
  /** Switch to Story tab + open the scene-creation tray.
   *  Wired by Studio because scenes (beats) are created in Story. */
  onAddScene: () => void;
  /** Wrap a Create-all action with the Studio-level scrim + sheet-close
   *  choreography. See `runGenerateAll` in Studio. */
  runGenerateAll: (fn: () => Promise<void>) => Promise<void>;
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
  const hasBeats = beats.length > 0;

  function dismissSync() {
    setStory(s => markLayerSynced(s, "script"));
  }

  // "Write all scenes with AI" — generates prose for every unwritten
  // beat one at a time.
  //
  // Previously this fired a single `sync_story_to_script` action asking
  // the model for ALL scenes in one JSON payload. With 14–22 scenes at
  // 100–400 words each, the response routinely blew past the 8192-token
  // ceiling in /api/generate, truncated mid-JSON, and `extractJson`
  // threw. Individual scene generation always worked because each call
  // stays well under the cap — so the fix is to reuse that per-beat
  // flow in a loop.
  //
  // Rules:
  //   - Skip beats that already have prose (status === "written" with
  //     non-empty sceneContent). This preserves user-edited scenes
  //     and lets the button act as a "fill the rest" action if the
  //     user partially wrote the script by hand.
  //   - On any failure, surface the error naming which scene failed
  //     and stop the loop. Scenes already written this run are kept.
  //   - Re-reads `story` via an updater snapshot every iteration so
  //     the contextBuilder sees prior scenes on disk (cohesion).
  const { profile } = useProfileCapture();
  const [genBusy, setGenBusy] = useState(false);
  async function generateAllScript() {
    if (genBusy) return;
    setGenBusy(true);
    try {
      await runGenerateAll(async () => {
        // Snapshot beats at start — beat ids are stable so we can
        // match back through story even if the beats array shape
        // changes during the loop.
        const beatsSnapshot = beats.map((b, i) => ({
          id: b.id,
          index: i,
          needsWriting:
            b.status !== "written" || !b.sceneContent?.trim(),
        }));

        for (const entry of beatsSnapshot) {
          if (!entry.needsWriting) continue;

          // Read the latest story out of React state so the scene
          // generator sees prior-iteration writes in its prompt.
          let currentStory: Story = story;
          setStory(s => { currentStory = s; return s; });

          const action: ActionRequest = {
            type: "generate_scene",
            payload: { beatIndex: entry.index },
          };

          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ story: currentStory, action, profile }),
          });
          if (!res.ok || !res.body) {
            const body = await res.text().catch(() => "");
            throw new Error(
              `Scene ${entry.index + 1} failed: ${res.status} ${body || "(no body)"}`,
            );
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let fullText = "";
          let streamError: string | null = null;
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
                if (msg.type === "text") fullText += msg.value;
                else if (msg.type === "error") streamError = msg.value;
              } catch {
                /* ignore malformed line */
              }
            }
          }
          if (streamError && !fullText) {
            throw new Error(`Scene ${entry.index + 1} failed: ${streamError}`);
          }
          if (!fullText.trim()) {
            throw new Error(`Scene ${entry.index + 1} returned no text.`);
          }

          // Persist this scene's prose onto the matching beat by id.
          // Mirrors the setBeats path used by run() for single-scene
          // generation, but matches by id rather than array index so
          // it's robust to re-ordering between iterations.
          const sceneText = fullText;
          const beatId = entry.id;
          setStory(s => {
            const sl = getActiveStoryLayerDraft(s);
            if (!sl) return s;
            const writeInto = (arr: Beat[]): Beat[] => arr.map(b =>
              b.id === beatId
                ? { ...b, status: "written" as const, sceneContent: sceneText }
                : b
            );
            if (s.projectType === "tv-show") {
              return updateStoryLayerDraft(s, {
                episodes: (sl.episodes ?? []).map(ep => ({
                  ...ep,
                  beats: writeInto(ep.beats),
                })),
              });
            }
            return updateStoryLayerDraft(s, { beats: writeInto(sl.beats) });
          });
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") window.alert(msg);
    } finally {
      setGenBusy(false);
    }
  }

  return (
    <>
      {/* onOpenReadThrough gated on hasProducedScript: the read-through
          sheet renders written scene prose, so the icon is meaningless
          when the Script tab is in its empty state (no beats written).
          Passing `undefined` tells LayerBar to skip the button entirely. */}
      <LayerBar
        layer="script"
        label="Script"
        story={story}
        setStory={setStory}
        autosaveEnabled={autosaveEnabled}
        onOpenUpdateTray={onOpenUpdateTray}
        onOpenReadThrough={hasProducedScript ? onOpenReadThrough : undefined}
      />

      {/* Top-of-content Tip — only surfaces once at least one scene
          has been written. On an empty Script the empty state already
          carries the primary teaching; this tip would pile on. */}
      {hasProducedScript && (
        <Tip id="script-scenes-from-outline" persist={false}>
          Every scene in the Story tab becomes prose here — the tighter your outline, the smoother the draft.
        </Tip>
      )}

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

      {/* Previously rendered a "{writtenCount}/{beats.length} scenes
          written." caption at the top of the Script tab. Removed per
          product direction — the per-scene cards already communicate
          written vs. unwritten state visually (prose vs. "Write this
          scene" button), so the aggregate counter was noisy overhead. */}

      {!hasBeats && (
        // Script's empty state is informational-only: no Add scene and
        // no Write all. The user is expected to sketch scenes in the
        // Story tab first (copy below explains this), so surfacing a
        // sticky "Add scene" here would invite entering this tab out
        // of flow. "Write all" is hidden too — with zero beats there's
        // nothing to generate prose from.
        <EmptyLayerState
          icon={<img src="/script-icon.svg" width={40} height={39} alt="" />}
          title="No scenes yet"
          caption="Sketch scenes in the Story tab, then return here to write them into prose."
        />
      )}

      {beats.map((beat, i) => {
        // Resolve the linked moments so the scene card can echo what the
        // user attached back in Story — useful when scanning written prose
        // to see which personal moments seeded each beat.
        const linkedMoments = beat.momentIds
          .map(id => moments.find(m => m.id === id))
          .filter((m): m is Moment => !!m);
        return (
        <div key={beat.id} className="beat-card">
          <div className="beat-header" style={{ cursor: "default" }}>
            <div className={`beat-number ${beat.status === "written" ? "written" : ""}`}>{i + 1}</div>
            <div className="beat-info">
              <div className="beat-name">{beat.name}</div>
              <div className="beat-summary-preview">{beat.summary}</div>
            </div>
            {/* Status badge removed per product direction — the card's
                body already telegraphs state (prose for "written", the
                "Write this scene" button for "design"), so the small
                uppercase flag was redundant noise. Keeping the wrapping
                structure intact so future badges (e.g., "stale") can
                slot back in without a layout rewrite. */}
          </div>
          {/* Linked moments — rendered under the beat summary so users
              skimming the Script tab see which personal moments fed each
              scene. Each row shows the moment type ("scene", "dialogue",
              "joke", …) as a small uppercase badge plus the moment text.
              Hidden when the scene has no linked moments. */}
          {linkedMoments.length > 0 && (
            <div className="scene-linked-moments">
              {linkedMoments.map(m => (
                <div key={m.id} className="scene-linked-moment">
                  <span className="scene-linked-moment-type">{m.type}</span>
                  <span className="scene-linked-moment-text">{m.text}</span>
                </div>
              ))}
            </div>
          )}
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
              {/* Secondary treatment on the per-scene CTA so it sits
                  quieter inside the card; the sticky "Write all scenes
                  with AI" bar remains the primary surface for bulk
                  generation. This keeps one primary button per screen
                  and lets the per-scene action read as an alternative,
                  not a competing, CTA. */}
              <Button variant="secondary" size="sm" disabled={busy}
                style={{ width: "100%" }}
                icon={<AISparkleIcon />}
                onClick={() => run(
                  { type: "generate_scene", payload: { beatIndex: i } },
                  `Write · ${beat.name}`
                )}>
                Write this scene with AI
              </Button>
            </div>
          )}
        </div>
        );
      })}

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

      {/* Sticky bottom action bar — only renders when the outline has
          at least TWO scenes (beats). With a single scene, the per-card
          "Write this scene with AI" button is sufficient and a bulk
          "Write all scenes with AI" CTA is redundant. Two-or-more is
          the threshold at which batching becomes meaningful and the
          sticky bar earns its real-estate. Hidden entirely on empty
          Script because the empty-state card already owns those CTAs. */}
      {beats.length >= 2 && (
        <>
          <div className="layer-sticky-bar-spacer" aria-hidden="true" />
          <LayerStickyBar
            label="Write all scenes with AI"
            onClick={generateAllScript}
            disabled={genBusy}
            icon={<AISparkleIcon />}
          />
        </>
      )}
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
    <div className="card import-script-card" style={{ marginTop: 47 }}>
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
        /* Leading upload glyph — tray-with-up-arrow icon that reads as
           "upload/import". Suppressed while importing so the spinner
           takes the icon slot and we don't have two leading marks
           competing. The Button's `icon` prop handles spacing. */
        icon={
          !importing ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          ) : undefined
        }
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

  return (
    <div className="stack">
      {/* Characters first. The picker is the most scene-shaping
          choice a writer makes, so it leads the sheet. Always
          rendered so users see the feature even on a blank project;
          if no characters exist yet, an empty-state hint takes the
          place of the chip row. */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Characters in this scene
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

      {/* 15px between the characters pills and the title field.
          Overrides the .stack sibling margin (12px) with an inline
          marginTop so the gap is exactly what the spec calls for. */}
      <Input
        placeholder="Scene name"
        value={name}
        onChange={e => setName(e.target.value)}
        style={{ marginTop: 15 }}
      />

      <Textarea placeholder="Describe this scene"
        value={summary} onChange={e => setSummary(e.target.value)} rows={4} />

      {/* Footer row: Clean Up With AI + Save. Equal-flex so the pair
          of CTAs reads as a balanced commit row; Save is primary
          (black) per the sheet's save-button convention, Clean Up is
          secondary + AI sparkle so the magic step is obvious. Clean
          Up is disabled until there's summary text to clean.
          marginTop bumped from 4 → 19 (+15) to breathe the row away
          from the Describe textarea per design direction. */}
      <div style={{ display: "flex", gap: 8, marginTop: 19 }}>
        <Button
          variant="secondary"
          size="sm"
          onClick={cleanUp}
          disabled={!summary.trim() || cleaning || busy}
          icon={<AISparkleIcon />}
          style={{ flex: 1 }}
        >
          {cleaning ? "Cleaning..." : "Clean up with AI"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => onSave(name || "Untitled scene", summary, selectedCharIds)}
          disabled={!summary.trim()}
          style={{ flex: 1 }}
        >
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

      {/* Collaborators — invite one other person to work on this
          project. This whole card is additive: it has no effect on
          projects that stay single-user. The invite machinery creates
          a shareable link; the invitee signs in and visits the link
          to join. A project can have at most one collaborator. */}
      <CollaboratorsCard story={story} />

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
/* ========= COLLABORATORS CARD =============== */
/* ============================================ */
// Renders inside SettingsTab. Two states:
//  - Not shared yet: button to generate an invite link.
//  - Shared (story.collaboratorUserId set): shows "Collaborator: <id>"
//    (Phase 2 will resolve to email/avatar) and a Remove button.
// Pending invites (created but not yet accepted) are listed with a
// copy-link button and a revoke button.

function CollaboratorsCard({ story }: { story: Story }) {
  const { user } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoadingInvites(true);
    listInvitesForProject(story.id, user.id).then(list => {
      if (cancelled) return;
      setInvites(list.filter(i => !i.acceptedAt));
      setLoadingInvites(false);
    });
    return () => { cancelled = true; };
  }, [user, story.id]);

  async function handleSend() {
    if (!user) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    // Light-touch email validation — we're not gatekeeping the UI on
    // strict RFC parsing, just catching obvious typos. The RPC will
    // still reject mismatches at accept time.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      alert("That doesn't look like a valid email address.");
      return;
    }
    if (user.email && trimmed.toLowerCase() === user.email.toLowerCase()) {
      alert("You can't invite yourself.");
      return;
    }
    setSending(true);
    const inv = await createInvite(story.id, user.id, trimmed);
    setSending(false);
    if (!inv) {
      alert("Couldn't send the invite. Check your connection and try again.");
      return;
    }
    setInvites(prev => [inv, ...prev]);
    setEmail("");
  }

  async function handleRevoke(token: string) {
    if (!confirm("Revoke this invite? The invitee won't be able to accept it.")) return;
    await revokeInvite(token);
    setInvites(prev => prev.filter(i => i.token !== token));
  }

  const hasCollaborator = !!story.collaboratorUserId;

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <span className="eyebrow">Collaborators</span>
      <div className="caption" style={{ marginTop: 6, marginBottom: 12 }}>
        {hasCollaborator
          ? "This project is shared with one collaborator. Each of you has your own drafts."
          : "Invite one person by email. Once they sign in, the invite appears on their dashboard to accept."}
      </div>

      {hasCollaborator ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            border: "1px solid var(--hairline, rgba(0,0,0,0.1))",
            borderRadius: 10,
            marginBottom: 8,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 24, height: 24, borderRadius: 12,
              background: "var(--ink, #111)", color: "var(--paper, #fff)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}
          >
            ?
          </div>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
            Collaborator connected
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="email"
            inputMode="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="collaborator@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !sending) handleSend();
            }}
            className="attr-text-input"
            style={{ flex: 1 }}
            disabled={sending}
          />
          <Button
            variant="primary"
            size="lg"
            onClick={handleSend}
            disabled={sending || !user || !email.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      )}

      {invites.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="caption" style={{ marginBottom: 8, opacity: 0.7 }}>
            Pending invites
          </div>
          {invites.map(inv => (
            <div
              key={inv.token}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                border: "1px solid var(--hairline, rgba(0,0,0,0.1))",
                borderRadius: 10,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              <div
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={inv.inviteeEmail ?? buildInviteUrl(inv.token)}
              >
                {inv.inviteeEmail ? (
                  <>
                    <span style={{ fontWeight: 500 }}>{inv.inviteeEmail}</span>
                    <span style={{ opacity: 0.55, marginLeft: 8, fontSize: 12 }}>waiting</span>
                  </>
                ) : (
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, opacity: 0.75 }}>
                    {buildInviteUrl(inv.token)}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleRevoke(inv.token)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "var(--ink, #111)",
                  fontSize: 12,
                  opacity: 0.65,
                  cursor: "pointer",
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {loadingInvites && invites.length === 0 && (
        <div className="caption" style={{ marginTop: 10, opacity: 0.6 }}>Loading invites…</div>
      )}
    </div>
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
