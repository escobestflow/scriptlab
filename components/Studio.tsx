"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo, createContext, useContext } from "react";
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
  formatSlugline,
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
import { useIsV2 } from "@/lib/v2Access";
import type { WriterProfile } from "@/lib/writerProfile";
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

/** Local copy of app/page.tsx's useIsDesktop — the hook isn't exported
 *  from there, so we duplicate the 10-line implementation rather than
 *  refactor across files. Keys on the same 1440px breakpoint the rest
 *  of v2 uses. SSR-safe: starts false until the effect runs. */
function useIsDesktopStudio(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1440px)");
    setV(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setV(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return v;
}

/** "Updated Nm/h/d ago" — relative-time formatter for the V2 desktop
 *  project hero. Mirrors the SettingsTab's local formatDate but lifted
 *  to module scope so the hero block can call it. */
function formatUpdatedAgo(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  initialSection,
  bgScriptJob = null,
  onStartBackgroundScriptLoop,
  onRegenerateThumbnail,
  isThumbnailInFlight = false,
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
  /** Which section tab to show on first paint. Used by Easy mode at
   *  project creation to drop the user on Script (the final output)
   *  rather than the default Concept. Set as the useState initializer
   *  rather than via useEffect so there's no one-frame flash of the
   *  default tab before the user-visible tab takes over. */
  initialSection?: Section;
  /** Background script-generation job. Set by app/page.tsx after Easy
   *  mode hands off to the Script tab (scene 1 written, scenes 2..N
   *  draining in the background). Drives:
   *    - per-beat spinners on unwritten beats in the Script tab
   *    - the "Write all scenes with AI" button being disabled
   *  null when no background loop is running for this project. */
  bgScriptJob?: {
    inflightBeatId: string | null;
    pendingBeatIds: Set<string>;
  } | null;
  /** Kick off the same background-loop machinery Easy mode uses. The
   *  returned Promise resolves when scene 1 is written + persisted (or
   *  the loop terminates with no work / an error). Studio's "Write all
   *  scenes with AI" wraps this in `runGenerateAll` so its scrim covers
   *  exactly scene 1; scenes 2..N stream into the Script tab via the
   *  `bgScriptJob` spinner cards. Owned by page.tsx because the loop's
   *  state has to outlive Studio (user can navigate away mid-run).
   *
   *  `opts.rewriteNewDraft` — when set, page.tsx clones the active
   *  story-layer + script-layer drafts and clears every beat to
   *  "design" before the loop runs. Studio passes this when the user
   *  taps the bulk button on a script that already has prose, so the
   *  prior prose is preserved on the older draft and the rewrite goes
   *  into a fresh one. */
  onStartBackgroundScriptLoop?: (
    story: Story,
    profile?: WriterProfile | null,
    opts?: { rewriteNewDraft?: boolean },
  ) => Promise<void>;
  /** Project thumbnail (re)generation. Lifted to page.tsx so the
   *  in-flight Set that backs the shimmer skin lives in a single
   *  place — both the home project cards AND the Settings-tab cover
   *  pulse together while a /api/generate-thumbnail call is live. */
  onRegenerateThumbnail?: (extra: string) => Promise<void>;
  /** Whether the active project's cover is currently being regenerated.
   *  Drives the shimmer overlay on the SettingsTab cover image. */
  isThumbnailInFlight?: boolean;
}) {
  const [section, setSection] = useState<Section>(initialSection ?? "concept");
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
  const isV2 = useIsV2();
  const isDesktop = useIsDesktopStudio();
  // TV-only: dropdown to switch the active episode. Sheet mirrors the
  // project-drafts treatment — same trigger style, same bottom-sheet.
  // Tapping an episode sets `activeEpisodeId` globally (so the Story tab
  // drills into that episode on next visit, and the trigger label
  // updates everywhere). Non-TV projects never render this.
  const [episodeSheetOpen, setEpisodeSheetOpen] = useState(false);
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
    // V2: hero stays fully opaque always (it's a persistent fixed
    // overlay in the v2 design, not a scrolling thumb). Reset any
    // residual inline opacity from a prior render and skip the v1
    // fade math.
    if (typeof document !== "undefined" && document.documentElement.dataset.design === "v2") {
      thumbRef.current.style.opacity = "";
      return;
    }
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
  // Scene sheet — single sheet used for BOTH scene creation and editing,
  // mirroring the character-sheet pattern. null = closed; an existing
  // beat id = open. `sceneSheetIsNew` distinguishes a freshly-inserted
  // blank scene from one the user explicitly opened, so the form can
  // hide the Delete CTA on a not-yet-committed scene.
  const [sceneSheetBeatId, setSceneSheetBeatId] = useState<string | null>(null);
  const [sceneSheetIsNew, setSceneSheetIsNew] = useState<boolean>(false);
  // v2 only — a lightweight preview popup that surfaces when the
  // user taps an already-saved beat in the Story tab. Shows the
  // scene image, name, summary, character avatars, estimated
  // duration, and an "Edit Scene" CTA that hands off to the full
  // edit sheet via `sceneSheetBeatId`. null = closed.
  const [scenePopupBeatId, setScenePopupBeatId] = useState<string | null>(null);
  // Where the popup was opened from. "story" = default preview
  // with prev/next nav + Edit Scene; "script-unwritten" = opened
  // from the Script tab on an unwritten beat, so the footer
  // surfaces a single primary "Script Scene" CTA instead.
  const [scenePopupVariant, setScenePopupVariant] = useState<"story" | "script-unwritten">("story");
  // v2 — Script View sheet (full screenplay prose, prev/next nav).
  // Distinct from scenePopupBeatId because the two surfaces show
  // different views of the same beat: the popup is a lightweight
  // preview, the sheet is the prose-reading mode. null = closed.
  const [scriptViewBeatId, setScriptViewBeatId] = useState<string | null>(null);
  // When true, the ScriptViewSheet opens with highlight mode pre-armed.
  // The desktop Script tab's HM button on the right pane sets both this
  // flag and `scriptViewBeatId` together — the sheet then handles the
  // full drag-to-highlight + composer flow (the same one Read-through
  // uses), avoiding a separate desktop-only implementation.
  const [scriptViewInitialHighlight, setScriptViewInitialHighlight] = useState(false);
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
  // When the Script View sheet's pencil routes us into the
  // read-through, these stash the scroll target + the pre-on
  // highlight-mode flag so the user lands in the right scene
  // with the highlighter already armed. Cleared on sheet close.
  const [readThroughInitialBeatId, setReadThroughInitialBeatId] = useState<string | null>(null);
  const [readThroughInitialHighlight, setReadThroughInitialHighlight] = useState(false);
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
    setSceneSheetBeatId(null);
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
    // Stamp the creator-episode for TV projects so cross-episode edits
    // can be locked downstream. Falls back to the first episode's id when
    // the user hasn't explicitly picked one yet, so a brand-new TV project
    // doesn't end up with a free-floating character that's editable
    // everywhere.
    const creatorEpisodeId = isTV
      ? (activeEpisodeId ?? activeStoryLayer.episodes?.[0]?.id ?? null)
      : null;
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
      ...(creatorEpisodeId ? { createdInEpisodeId: creatorEpisodeId } : {}),
    };
    setStory(s => updateCharactersDraft(s, {
      characters: [...getActiveCharactersDraft(s).characters, newChar],
    }));
    setCharSheetCharId(newChar.id);
  };
  // ── Scene sheet open/close ──
  // Mirrors the character-sheet pattern: opening "new" optimistically
  // inserts a blank beat at the requested position, opens its sheet, and
  // discards the blank record on close if nothing was filled in.
  const openExistingSceneSheet = (id: string) => {
    setSceneSheetIsNew(false);
    setSceneSheetBeatId(id);
  };
  const openNewSceneSheet = (insertAt?: number) => {
    setSceneSheetIsNew(true);
    const newBeat: Beat = {
      id: "b_" + Math.random().toString(36).slice(2),
      name: "",
      summary: "",
      purpose: "",
      position: 0,
      momentIds: [],
      characterIds: [],
      status: "design",
    };
    setBeats(bs => {
      const idx = insertAt != null ? insertAt : bs.length;
      const updated = [...bs];
      updated.splice(idx, 0, newBeat);
      return updated.map((b, i) => ({ ...b, position: i }));
    });
    setSceneSheetBeatId(newBeat.id);
  };
  const closeSceneSheet = () => {
    const id = sceneSheetBeatId;
    if (!id) return;
    // Capture pre-close beat for auto-gen-image so we can decide
    // whether to fire it without racing the discard logic below.
    const preBeats = (() => {
      if (isTV && activeEpisodeId) {
        const ep = getActiveStoryLayerDraft(story).episodes?.find(e => e.id === activeEpisodeId);
        return ep?.beats ?? [];
      }
      return getActiveStoryLayerDraft(story).beats;
    })();
    const pre = preBeats.find(b => b.id === id);
    // Auto-discard a blank scene (no name + no summary + no linked
    // ideas + no characters + no twist/weirdness dial moved).
    setBeats(bs => {
      const beat = bs.find(b => b.id === id);
      if (!beat) return bs;
      const isBlank =
        !beat.name.trim() &&
        !beat.summary.trim() &&
        beat.momentIds.length === 0 &&
        (beat.characterIds ?? []).length === 0 &&
        beat.twist === undefined &&
        beat.weirdness === undefined;
      if (!isBlank) return bs;
      return bs.filter(b => b.id !== id).map((b, i) => ({ ...b, position: i }));
    });
    setSceneSheetBeatId(null);

    // Image auto-generate: fires when the scene wasn't auto-discarded
    // (has at least a name) AND has no thumbnail yet. Mirrors the
    // characters auto-gen on character-sheet close.
    const needsImage =
      pre &&
      pre.name.trim().length > 0 &&
      !pre.thumbnail;
    if (needsImage) {
      autoGenerateSceneImage(pre.id).catch(err => {
        console.warn("Scene image auto-generate skipped:", err);
      });
    }
  };

  // Track which beats / characters are currently having a
  // thumbnail generated so the auto-fill effects below don't
  // double-fire on the same id across re-renders (story state
  // mutates several times during a single request lifecycle).
  // Dual tracking: ref for synchronous dedup across loop iterations
  // in a single useEffect tick (setState is batched, so reading the
  // state Set would lag), state Set for UI reactivity — the shimmer
  // placeholder for each scene / character image subscribes here.
  // Invariant: id ∈ inFlightState ⇔ a generate-* request is currently
  // pending for that id ⇔ shimmer is rendering.
  const sceneImagesInFlight = useRef<Set<string>>(new Set());
  const characterImagesInFlight = useRef<Set<string>>(new Set());
  // Sentinel for "auto-gen has already failed/aborted for this id";
  // skips further auto-retry on subsequent story-state changes. The
  // user can still trigger a manual regen from the character edit
  // sheet's Generate button. Cleared whenever the user toggles back
  // into the project from elsewhere (component remount). Defense-in-
  // depth: the PERSISTENT `imageGenAttempted` flag on the row is the
  // primary stop; these refs cover the case where the flag's setStory
  // hasn't flushed yet within a single session.
  const characterImagesFailed = useRef<Set<string>>(new Set());
  const sceneImagesFailed = useRef<Set<string>>(new Set());
  const [scenesInFlight, setScenesInFlight] = useState<Set<string>>(new Set());
  const [charsInFlight, setCharsInFlight] = useState<Set<string>>(new Set());

  // Auto-fill missing scene thumbnails. Fires whenever the story
  // state changes — picks up beats produced by the bulk Add All
  // Scenes path, individual sheet saves, easy-mode runs, or any
  // future path that creates beats without a thumbnail.
  // Dedup + in-flight tracking happens INSIDE autoGenerateSceneImage
  // so any caller (bulk loop, close-sheet path, form button) is safe.
  useEffect(() => {
    const draft = getActiveStoryLayerDraft(story);
    const allBeats = isTV && activeEpisodeId
      ? (draft.episodes?.find(e => e.id === activeEpisodeId)?.beats ?? [])
      : draft.beats;
    for (const b of allBeats) {
      if (b.name?.trim() && !b.thumbnail) {
        autoGenerateSceneImage(b.id).catch(() => { /* swallow */ });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, isTV, activeEpisodeId]);

  // Same auto-fill, characters edition. Fires on story-state
  // change for any character with a name + no thumbnail. Picks
  // up cast produced by the bulk Add All Characters path AND
  // by easy-mode sync_concept_to_characters runs.
  useEffect(() => {
    const draft = getActiveCharactersDraft(story);
    for (const c of draft.characters) {
      if (c.name?.trim() && !c.thumbnail) {
        autoGenerateCharacterImage(c.id).catch(() => { /* swallow */ });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story]);

  // One-shot diagnostic on initial story load — surfaces in DevTools
  // exactly which characters had a thumbnail vs. which didn't on the
  // freshest load from Supabase. If a character the user expects to
  // already have an image shows `thumbnail=NONE` here, the data round-
  // tripped through the DB and came back without it.
  const characterThumbAuditFired = useRef(false);
  useEffect(() => {
    if (characterThumbAuditFired.current) return;
    const draft = getActiveCharactersDraft(story);
    if (draft.characters.length === 0) return;
    characterThumbAuditFired.current = true;
    const audit = draft.characters.map(c => ({
      id: c.id.slice(0, 8),
      name: c.name,
      thumbnail: c.thumbnail
        ? `present (${c.thumbnail.startsWith("data:") ? "data-url, " + c.thumbnail.length + " chars" : c.thumbnail.slice(0, 60) + "…"})`
        : "NONE",
    }));
    console.log("[character thumbnail audit]", audit);
  }, [story]);

  // ── Background migration: inline base64 thumbnails → Storage URLs ──
  // Walks every character/beat in the drafts on story load. For each
  // thumbnail that's still in legacy `data:image/jpeg;base64,...`
  // form, POSTs it to /api/migrate-image-thumbnail and accumulates
  // the resulting Storage URL. After ALL uploads have completed
  // (or the user navigates away), applies every URL swap in a
  // SINGLE setStory call so the autosave debouncer only fires once
  // — on the now-small row.
  //
  // This batching is critical: a project with 20 inline thumbnails
  // is ~2MB. If we setStory after every upload, the autosave fires
  // 20 times, each one trying to upsert a still-mostly-2MB row, and
  // Supabase Postgres cancels each query (statement_timeout / code
  // 57014). All saves fail, all data stays inline, the next reload
  // re-uploads everything and orphans 20 Storage blobs.
  //
  // With batching, only ONE save fires after the batch, on the row
  // that's already shrunk to ~20 URLs (~ a few KB). It succeeds.
  //
  // The `thumbMigrationDone` ref dedupes successful uploads across
  // re-entries so a setStory triggered partway doesn't redo work.
  // `thumbMigrationDisabled` is the kill switch for the rest of the
  // session when the migration endpoint reports 503 (no service-role
  // key) or any other terminal failure.
  const thumbMigrationDone = useRef<Set<string>>(new Set());
  const thumbMigrationDisabled = useRef<boolean>(false);
  const thumbMigrationRunning = useRef<boolean>(false);
  useEffect(() => {
    if (thumbMigrationDisabled.current) return;
    // Guard against re-entry: while a batched migration pass is
    // already running, ignore any [story] re-fires (which happen
    // naturally when the user types, switches drafts, etc.). The
    // pass currently in flight will see the existing data URLs and
    // do the work; later passes can pick up anything new.
    if (thumbMigrationRunning.current) return;
    // INTENTIONALLY NO `cancelled` flag — the previous implementation
    // tracked a closure-scoped `cancelled` boolean set by useEffect's
    // cleanup function. But ANY [story] re-fire (autosave-driven
    // re-renders, autoGenCharacterImage's imageGenAttempted setStory,
    // etc.) called that cleanup, set cancelled=true, and the running
    // IIFE aborted at its first cancellation check — before the
    // fetch() even fired. Result: "queued 1" logged, no network
    // request, no swap log, migration silently dead. Letting the
    // migration always run to completion is safe: if Studio unmounts
    // mid-flight, the trailing setStory becomes a no-op on the
    // unmounted tree, which is harmless.

    async function uploadOne(
      bucket: "character-images" | "scene-images",
      idKey: string,
      dataUrl: string,
    ): Promise<string | null> {
      if (thumbMigrationDisabled.current) return null;
      if (thumbMigrationDone.current.has(idKey)) return null;
      console.log(`[thumbnail migration] uploadOne POST starting for ${idKey} (dataUrl length ${dataUrl.length})`);
      try {
        const res = await fetch("/api/migrate-image-thumbnail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl, bucket }),
        });
        console.log(`[thumbnail migration] uploadOne POST returned status ${res.status} for ${idKey}`);
        if (res.status === 503) {
          console.warn("[thumbnail migration] Storage not configured (SUPABASE_SERVICE_ROLE_KEY missing). Skipping.");
          thumbMigrationDisabled.current = true;
          return null;
        }
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const data = await res.json();
            if (data?.error) msg = String(data.error);
          } catch { /* ignore */ }
          console.error(`[thumbnail migration] ${idKey}: ${msg}`);
          return null;
        }
        const data = await res.json();
        const url = typeof data?.url === "string" ? data.url : null;
        if (!url) {
          console.error(`[thumbnail migration] ${idKey}: API returned no url`);
          return null;
        }
        thumbMigrationDone.current.add(idKey);
        console.log(`[thumbnail migration] uploadOne SUCCESS for ${idKey} → ${url}`);
        return url;
      } catch (err: any) {
        console.error(`[thumbnail migration] ${idKey} threw:`, err?.message || err);
        return null;
      }
    }

    // Snapshot the work-list synchronously from the current story
    // so partway-through setStory calls (which we DON'T make any
    // more, but defensively) can't cause us to re-walk.
    const work: Array<{
      key: string;
      bucket: "character-images" | "scene-images";
      dataUrl: string;
      // Pure functions: given a Story + new URL, return a new Story
      // with the swap applied. Applied in batch at the end.
      patchStory: (story: Story, url: string) => Story;
    }> = [];

    for (const cd of story.charactersDrafts) {
      for (const c of cd.characters) {
        if (typeof c.thumbnail !== "string" || !c.thumbnail.startsWith("data:image/")) continue;
        const key = `char:${c.id}`;
        if (thumbMigrationDone.current.has(key)) continue;
        const characterDraftId = cd.id;
        const characterId = c.id;
        const dataUrl = c.thumbnail;
        work.push({
          key,
          bucket: "character-images",
          dataUrl,
          patchStory: (s, url) => ({
            ...s,
            charactersDrafts: s.charactersDrafts.map(d =>
              d.id !== characterDraftId ? d : {
                ...d,
                characters: d.characters.map(ch =>
                  ch.id !== characterId ? ch :
                  ch.thumbnail === dataUrl ? { ...ch, thumbnail: url } : ch,
                ),
              }
            ),
          }),
        });
      }
    }
    for (const sd of story.storyDrafts) {
      const beatLists: Array<{ beats: typeof sd.beats; episodeId?: string }> = [];
      if (sd.beats && sd.beats.length > 0) beatLists.push({ beats: sd.beats });
      for (const ep of sd.episodes ?? []) beatLists.push({ beats: ep.beats, episodeId: ep.id });
      for (const list of beatLists) {
        for (const b of list.beats) {
          if (typeof b.thumbnail !== "string" || !b.thumbnail.startsWith("data:image/")) continue;
          const key = `beat:${b.id}`;
          if (thumbMigrationDone.current.has(key)) continue;
          const storyDraftId = sd.id;
          const episodeId = list.episodeId;
          const beatId = b.id;
          const dataUrl = b.thumbnail;
          work.push({
            key,
            bucket: "scene-images",
            dataUrl,
            patchStory: (s, url) => ({
              ...s,
              storyDrafts: s.storyDrafts.map(d => {
                if (d.id !== storyDraftId) return d;
                const swapBeat = (bb: Beat) =>
                  bb.id === beatId && bb.thumbnail === dataUrl
                    ? { ...bb, thumbnail: url } : bb;
                if (episodeId) {
                  return {
                    ...d,
                    episodes: (d.episodes ?? []).map(ep =>
                      ep.id === episodeId
                        ? { ...ep, beats: ep.beats.map(swapBeat) } : ep,
                    ),
                  };
                }
                return { ...d, beats: d.beats.map(swapBeat) };
              }),
            }),
          });
        }
      }
    }

    if (work.length === 0) return;

    thumbMigrationRunning.current = true;
    console.log(`[thumbnail migration] queued ${work.length} legacy data-URL thumbnails to upload to Storage (batched — single setStory at end)`);

    (async () => {
      try {
        // Upload all sequentially. Collect successful results.
        const results: Array<{ patchStory: typeof work[0]["patchStory"]; url: string }> = [];
        for (let i = 0; i < work.length; i++) {
          const item = work[i];
          console.log(`[thumbnail migration] iter ${i + 1}/${work.length} for ${item.key}`);
          if (thumbMigrationDisabled.current) {
            console.log(`[thumbnail migration] iter ${i + 1} skipped — disabled`);
            break;
          }
          const url = await uploadOne(item.bucket, item.key, item.dataUrl);
          if (url) results.push({ patchStory: item.patchStory, url });
        }
        if (results.length === 0) {
          console.log(`[thumbnail migration] loop completed — 0 successes, nothing to setStory`);
          return;
        }
        // SINGLE setStory that applies every URL swap. The autosave
        // debouncer fires once 1s later, on the now-small row.
        setStory(s => {
          let next = s;
          for (const r of results) next = r.patchStory(next, r.url);
          return next;
        });
        console.log(`[thumbnail migration] swapped ${results.length}/${work.length} thumbnails to Storage URLs — autosave will persist shortly`);
      } catch (e: any) {
        console.error(`[thumbnail migration] IIFE threw:`, e?.message || e);
      } finally {
        thumbMigrationRunning.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story]);

  // Auto-fit the V2 desktop hero title to its 476px text box.
  // The `.v2-desktop-hero-title` element renders at the
  // `ds-type-project-page-title` token's natural size (Poynter /
  // 65px on desktop). For long titles whose natural rendered width
  // exceeds 476px, scale the inline font-size DOWN proportionally
  // so the title stays on a SINGLE line — no break, no ellipsis.
  // Re-runs when the title string changes; also re-runs once on
  // document.fonts.ready so the swap from a system fallback to the
  // loaded Poynter face doesn't leave a stale fit.
  const heroTitleRef = useRef<HTMLHeadingElement | null>(null);
  useLayoutEffect(() => {
    if (!isV2 || !isDesktop) return;
    const el = heroTitleRef.current;
    if (!el) return;
    const fit = () => {
      // Reset to the token's natural size before remeasuring so
      // re-fits don't compound previous shrinks.
      el.style.fontSize = "";
      const natural = el.scrollWidth;
      const target = 476;
      if (natural > target) {
        const currentPx = parseFloat(window.getComputedStyle(el).fontSize);
        el.style.fontSize = `${(target / natural) * currentPx}px`;
      }
    };
    fit();
    // Re-fit after web fonts settle (Poynter on first load may
    // initially measure with a system fallback, throwing off the
    // first fit pass).
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(fit).catch(() => {});
    }
  }, [story.title, isV2, isDesktop]);


  // Studio-level scene-image generation. Fire-and-forget; result
  // patches back via setStory and won't overwrite a thumbnail the
  // user manually set in the meantime. Mirrors
  // autoGenerateCharacterImage with the scene-specific endpoint.
  //
  // Dedup + shimmer wiring: the ref-Set prevents same-tick double
  // calls (state updates are batched), and the state-Set drives the
  // shimmer placeholder on each scene's thumb slot. Both flip
  // together at the start, and both clear together in `finally` —
  // so "shimmering" is a precise signal that an API call is live.
  async function autoGenerateSceneImage(beatId: string): Promise<void> {
    if (sceneImagesInFlight.current.has(beatId)) return;
    // Mirror the character circuit-breaker — one failed/aborted
    // attempt per beat per session, never re-fired.
    if (sceneImagesFailed.current.has(beatId)) return;
    const draft = getActiveStoryLayerDraft(story);
    const allBeats = isTV && activeEpisodeId
      ? (draft.episodes?.find(e => e.id === activeEpisodeId)?.beats ?? [])
      : draft.beats;
    const beat = allBeats.find(b => b.id === beatId);
    if (!beat || beat.thumbnail) return;
    // PERSISTENT sentinel — once this beat has been tried (success or
    // fail) the flag is saved on the row. Auto-gen never reattempts
    // across reloads. Manual regen from the beat edit sheet still
    // works. Same guarantee as Character.imageGenAttempted above.
    if (beat.imageGenAttempted) {
      console.log(`[autoGenerateSceneImage] skipped beat="${beat.name}" id=${beatId} — imageGenAttempted=true (manual regen via beat sheet only)`);
      return;
    }
    const description = [
      beat.name && `Beat: ${beat.name}`,
      beat.summary && `Summary: ${beat.summary}`,
      beat.purpose && `Purpose: ${beat.purpose}`,
    ].filter(Boolean).join("\n");
    if (!description.trim()) return;
    console.log(`[autoGenerateSceneImage] firing for beat="${beat.name}" id=${beatId} — thumbnail missing on load`);
    // Stamp the attempted-flag immediately, before the fetch. See
    // the same reasoning in autoGenerateCharacterImage above.
    setBeats(bs => bs.map(b =>
      b.id === beatId && !b.imageGenAttempted ? { ...b, imageGenAttempted: true } : b
    ));
    sceneImagesInFlight.current.add(beatId);
    setScenesInFlight(prev => {
      const next = new Set(prev);
      next.add(beatId);
      return next;
    });
    // 60s abort guard — mirrors the character path.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("timeout-60s"), 60_000);
    try {
      const concept = getActiveConceptDraft(story);
      const primaryGenre = concept.settings?.genres?.[0];
      const projectTone = concept.concept?.tone;
      const res = await fetch("/api/generate-scene-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, genre: primaryGenre, tone: projectTone }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          if (errData?.error) message = String(errData.error);
        } catch { /* non-JSON body */ }
        console.error(`[autoGenerateSceneImage] beat="${beat.name}" id=${beatId}: ${message}`);
        sceneImagesFailed.current.add(beatId);
        return;
      }
      const data = await res.json();
      const thumb = typeof data?.thumbnail === "string" ? data.thumbnail : null;
      if (!thumb) {
        console.error(`[autoGenerateSceneImage] beat="${beat.name}" id=${beatId}: API returned no thumbnail`);
        sceneImagesFailed.current.add(beatId);
        return;
      }
      setBeats(bs => bs.map(b =>
        b.id === beatId && !b.thumbnail ? { ...b, thumbnail: thumb } : b
      ));
    } catch (err: any) {
      const msg = err?.name === "AbortError" || err?.message?.includes("aborted")
        ? "aborted after 60s (upstream hang)"
        : (err?.message || String(err));
      console.error(`[autoGenerateSceneImage] beat="${beat.name}" id=${beatId} threw:`, msg);
      sceneImagesFailed.current.add(beatId);
    } finally {
      clearTimeout(timeoutId);
      sceneImagesInFlight.current.delete(beatId);
      setScenesInFlight(prev => {
        const next = new Set(prev);
        next.delete(beatId);
        return next;
      });
    }
  }

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

    // Image auto-generate: only fires for the create flow
    // (`charSheetIsNew`). Triggered when the character isn't about to
    // be auto-discarded, doesn't already have a thumbnail, and has a
    // name to anchor the prompt. This is what makes the create flow
    // feel "save → portrait appears" without surfacing a Generate
    // button on the create sheet itself. Edits go through the form's
    // explicit Generate / Upload buttons instead.
    const needsImage =
      charSheetIsNew &&
      pre &&
      pre.name.trim().length > 0 &&
      !pre.thumbnail;
    if (needsImage) {
      autoGenerateCharacterImage(pre.id).catch(err => {
        console.warn("Character image auto-generate skipped:", err);
      });
    }
  };

  // Studio-level character image generation for the auto-on-create
  // flow. Mirrors CharacterEditForm.generateImage but reads from the
  // current `story` ref so it can run after the sheet has already
  // closed. Fire-and-forget: the JPEG data URL is patched back onto
  // Character.thumbnail via setStory. If the user opened the edit
  // sheet in the meantime and manually regenerated, the most recent
  // setStory wins by virtue of React's normal update ordering.
  async function autoGenerateCharacterImage(characterId: string): Promise<void> {
    if (characterImagesInFlight.current.has(characterId)) return;
    // Hard skip — once a character fails (or is skipped/aborted),
    // don't keep retrying on every story-state change. The retry
    // loop was what kept the shimmer pinned on screen forever when
    // the underlying call hangs or errors. The user can manually
    // retry from the character edit sheet's Generate button.
    if (characterImagesFailed.current.has(characterId)) return;
    const chars = getActiveCharactersDraft(story).characters;
    const ch = chars.find(c => c.id === characterId);
    if (!ch || ch.thumbnail) return;
    // PERSISTENT sentinel — set on every successful AND failed prior
    // attempt and stored on the character row. If we've ever tried
    // for this character, never auto-retry. Even if the thumbnail
    // is somehow missing from the loaded row, we skip. This is the
    // last line of defense against the "auto-gen burns my OpenAI
    // credit on every reload" failure mode the user reported.
    if (ch.imageGenAttempted) {
      console.log(`[autoGenerateCharacterImage] skipped "${ch.name}" id=${characterId} — imageGenAttempted=true (manual regen via edit sheet only)`);
      return;
    }
    const roleLabelMap: Record<string, string> = {
      protagonist: "Protagonist", antagonist: "Antagonist",
      supporting: "Supporting", mentor: "Mentor",
      love_interest: "Love Interest", comic_relief: "Comic Relief",
    };
    const description = [
      ch.name && `Name: ${ch.name}`,
      ch.role && `Role: ${roleLabelMap[ch.role] || ch.role}`,
      ch.gender && `Gender: ${ch.gender}`,
      ch.archetype && `Archetype: ${ch.archetype}`,
      ch.backstory && `Backstory: ${ch.backstory}`,
      ch.motivations && `Motivations: ${ch.motivations}`,
      ch.flaws && `Flaws: ${ch.flaws}`,
    ].filter(Boolean).join("\n");
    if (!description.trim()) return;
    // DIAGNOSTIC — surfaces in DevTools any time this fires. If the
    // user sees this log for a character they expect to already have
    // a thumbnail, the thumbnail isn't in the loaded data (Supabase
    // returned a row without it, or normalize stripped it).
    console.log(`[autoGenerateCharacterImage] firing for "${ch.name}" id=${characterId} — thumbnail missing on load`);
    // STAMP the persistent attempted-flag IMMEDIATELY, before the
    // fetch. Two reasons:
    //   1. If the API hangs or aborts, the flag still gets saved by
    //      the autosave debouncer — so no future session will retry.
    //   2. If the [story] dep re-fires the effect mid-flight, the
    //      early-return at the top of this function reads the now-
    //      true flag and bails. Belt-and-suspenders with the
    //      in-flight ref guard.
    setStory(s => {
      const live = getActiveCharactersDraft(s).characters;
      const liveCh = live.find(c => c.id === characterId);
      if (!liveCh || liveCh.imageGenAttempted) return s;
      return updateCharactersDraft(s, {
        characters: live.map(c =>
          c.id === characterId ? { ...c, imageGenAttempted: true } : c
        ),
      });
    });
    // Flip both ref + state simultaneously. The state flip triggers
    // the shimmer overlay on every render-site that displays this
    // character's portrait; the ref flip prevents same-tick re-entry
    // (state ops are batched, refs are sync).
    characterImagesInFlight.current.add(characterId);
    setCharsInFlight(prev => {
      const next = new Set(prev);
      next.add(characterId);
      return next;
    });
    // 60s abort guard — prevents the in-flight state (and thus the
    // shimmer) from sticking forever when the upstream call hangs.
    // Independent of the route's own timeout because gpt-image-2 +
    // dall-e-3 fallback can compound.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("timeout-60s"), 60_000);
    try {
      const concept = getActiveConceptDraft(story);
      const primaryGenre = concept.settings?.genres?.[0];
      const projectTone = concept.concept?.tone;
      const res = await fetch("/api/generate-character-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, genre: primaryGenre, tone: projectTone }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          if (errData?.error) message = String(errData.error);
        } catch { /* non-JSON body */ }
        console.error(`[autoGenerateCharacterImage] character="${ch.name}" id=${characterId}: ${message}`);
        characterImagesFailed.current.add(characterId);
        return;
      }
      const data = await res.json();
      const thumb = typeof data?.thumbnail === "string" ? data.thumbnail : null;
      if (!thumb) {
        console.error(`[autoGenerateCharacterImage] character="${ch.name}" id=${characterId}: API returned no thumbnail`);
        characterImagesFailed.current.add(characterId);
        return;
      }
      setStory(s => {
        const live = getActiveCharactersDraft(s).characters;
        const liveCh = live.find(c => c.id === characterId);
        // Don't overwrite a thumbnail the user has set in the meantime
        // (e.g. opened the edit sheet and manually generated/uploaded).
        if (!liveCh || liveCh.thumbnail) return s;
        return updateCharactersDraft(s, {
          characters: live.map(c =>
            c.id === characterId ? { ...c, thumbnail: thumb } : c
          ),
        });
      });
    } catch (err: any) {
      const msg = err?.name === "AbortError" || err?.message?.includes("aborted")
        ? "aborted after 60s (upstream hang)"
        : (err?.message || String(err));
      console.error(`[autoGenerateCharacterImage] character="${ch.name}" id=${characterId} threw:`, msg);
      characterImagesFailed.current.add(characterId);
    } finally {
      clearTimeout(timeoutId);
      characterImagesInFlight.current.delete(characterId);
      setCharsInFlight(prev => {
        const next = new Set(prev);
        next.delete(characterId);
        return next;
      });
    }
  }

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
    let text = "";
    try {
      text = await extractTextFromFile(file);
    } catch (e: any) {
      if (typeof window !== "undefined") {
        window.alert(`Script import failed:\n\n${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    if (!text.trim()) {
      if (typeof window !== "undefined") {
        window.alert(
          "No text could be extracted from this file. If it's a PDF, " +
          "its text layer may be image-based (scanned) — try re-exporting " +
          "from your screenwriting app as a text-based PDF or .txt."
        );
      }
      return;
    }
    await importScriptFromText(text);
  }

  // Shared screenplay-import pipeline. Same 4 steps as the file path,
  // just starting from raw text — used by both the file-upload entry
  // point and the new "Paste a script" option in the import sheet.
  async function importScriptFromText(text: string) {
    if (importing) return;
    setImporting(true);
    setImportStep(null);
    try {
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

  // Description-based import. The user pastes a free-form story
  // description (not a screenplay) and we fan out concept → story →
  // characters → script in that order. Treat the pasted text as the
  // Concept summary, then let each downstream sync derive its layer
  // from the concept.
  //
  // Order matters here: characters is run after story so the cast is
  // shaped by both the concept and the beats it produced. Script runs
  // last so it has every other layer to draw on.
  //
  // Reuses the same `importing` / `importStep` state as file import so
  // the spinner UX is identical and the loading caption switches as
  // each step lands.
  async function importStoryFromDescription(text: string) {
    if (importing) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setImporting(true);
    setImportStep(null);
    try {
      // Seed the active Concept draft's `summary` with the pasted text
      // so every downstream sync_concept_to_* prompt has it as the
      // primary source-of-truth field. Other concept fields (logline,
      // tone, themes, endingTypes) are left for the final Concept
      // refresh to fill.
      const seeded = updateConceptDraft(story, {
        concept: { ...getActiveConceptDraft(story).concept, summary: trimmed },
      });

      setImportStep("story");
      let next = await syncLayer(seeded, "concept", "story", profile);

      setImportStep("characters");
      next = await syncLayer(next, "concept", "characters", profile);

      setImportStep("script");
      next = await syncLayer(next, "concept", "script", profile);

      // Final pass: refresh the Concept layer (logline/tone/themes/
      // endingTypes) from the freshly-written script so all four
      // layers cohere, mirroring the tail of the file-import path.
      setImportStep("concept");
      next = await syncLayer(next, "script", "concept", profile);

      setStory(() => next);
      setSection("script");
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") {
        window.alert(`Description import failed:\n\n${msg}`);
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
              onRegenerateThumbnail={onRegenerateThumbnail}
              isThumbnailInFlight={isThumbnailInFlight}
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

        {/* V2 desktop hero — image LEFT, title block RIGHT. Replaces
            the v2 mobile sticky thumb + header-sticky title treatment
            on viewports ≥1440. CSS hides the mobile equivalents on
            desktop so they don't duplicate or fight for position. */}
        {isV2 && isDesktop && (
          <div className="v2-desktop-hero">
            <button
              type="button"
              className="v2-desktop-hero-image"
              onClick={() => setShowSetup(true)}
              aria-label="Open project settings"
            >
              {story.thumbnail ? (
                <img src={story.thumbnail} alt="" />
              ) : (
                <div className="v2-desktop-hero-image-placeholder">
                  {story.title ? story.title.charAt(0).toUpperCase() : "?"}
                </div>
              )}
            </button>
            <div className="v2-desktop-hero-meta">
              <button
                type="button"
                className="drafts-dropdown-trigger ds-type-draft-dropdown v2-desktop-hero-draft"
                onClick={() => setDraftsDropdownOpen(v => !v)}
              >
                <span>Draft {activeProjectDraft.number}</span>
                <img src="/icon-draft-dropdown-caret.svg" alt="" className={`drafts-caret ${draftsDropdownOpen ? "open" : ""}`} />
              </button>
              <h1 className="v2-desktop-hero-title ds-type-project-page-title" ref={heroTitleRef}>
                {story.title || "Untitled"}
              </h1>
              <div className="v2-desktop-hero-rule" aria-hidden="true" />
              {(() => {
                // Description is the raw logline. CSS `-webkit-line-clamp:2`
                // on `.v2-desktop-hero-description` truncates with an
                // ellipsis before the text would break to a 3rd line.
                const text = activeConcept.logline?.trim();
                if (!text) return null;
                return <p className="v2-desktop-hero-description">{text}</p>;
              })()}
              <div className="v2-desktop-hero-updated">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/>
                  <polyline points="12 7 12 12 15 14"/>
                </svg>
                <span>Updated {formatUpdatedAgo(story.updatedAt)}</span>
              </div>
            </div>
          </div>
        )}

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

        {/* V2 empty-state title + project-draft trigger painted ON the
            project image. Mirrors the studio-header-sticky title +
            drafts trigger, but in white over the image. Rendered only
            in v2 — v1 has no empty-state composition for this. CSS
            controls fade-in/out via opacity transitions keyed off
            `:has(.studio-empty-overlay)` so the cross-dissolve with
            the top-nav title happens automatically when a layer's
            empty/populated state changes. */}
        {isV2 && (
          <div className="studio-thumb-empty-title">
            <div className="studio-thumb-empty-title-text ds-type-project-page-title-empty">
              {story.title || "Untitled"}
            </div>
            <div className="studio-thumb-empty-divider" aria-hidden="true" />
            <button
              type="button"
              className="studio-thumb-empty-draft drafts-dropdown-trigger ds-type-draft-dropdown"
              onClick={() => setDraftsDropdownOpen(v => !v)}
            >
              <span>Draft {activeProjectDraft.number}</span>
              <img src="/icon-draft-dropdown-caret.svg" alt="" className={`drafts-caret ${draftsDropdownOpen ? "open" : ""}`} />
            </button>
          </div>
        )}

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
              duplicating the dropdown.

              For TV shows, an episode trigger is rendered to the left
              in the same row treatment, so the user picks Episode →
              Draft as one motion. The two triggers are mutually
              exclusive: opening either closes the other. */}
          {isTV && (activeStoryLayer.episodes?.length ?? 0) > 0 ? (
            <div className="project-drafts-row">
              <button
                className="drafts-dropdown-trigger"
                onClick={() => {
                  setDraftsDropdownOpen(false);
                  setEpisodeSheetOpen(v => !v);
                }}
                aria-label="Pick episode"
              >
                <span>{(() => {
                  const ep = activeEpisode ?? activeStoryLayer.episodes?.[0];
                  return ep ? `Episode ${ep.number}` : "Episodes";
                })()}</span>
                <img src="/icon-draft-dropdown-caret.svg" alt="" className={`drafts-caret ${episodeSheetOpen ? "open" : ""}`} />
              </button>
              <button
                className="drafts-dropdown-trigger"
                onClick={() => {
                  setEpisodeSheetOpen(false);
                  setDraftsDropdownOpen(v => !v);
                }}
              >
                <span>Draft {activeProjectDraft.number}</span>
                <img src="/icon-draft-dropdown-caret.svg" alt="" className={`drafts-caret ${draftsDropdownOpen ? "open" : ""}`} />
              </button>
            </div>
          ) : (
            <button
              className="drafts-dropdown-trigger ds-type-draft-dropdown"
              onClick={() => setDraftsDropdownOpen(v => !v)}
            >
              <span>Draft {activeProjectDraft.number}</span>
              <img src="/icon-draft-dropdown-caret.svg" alt="" className={`drafts-caret ${draftsDropdownOpen ? "open" : ""}`} />
            </button>
          )}

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
                  <img src="/icon-draft-dropdown-caret.svg" alt="" className="drafts-caret open" />
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

        {/* Episode-picker bottom sheet (TV-only). Reuses the project-
            drafts sheet styling — same `.draft-sheet` and
            `.drafts-dropdown-item` treatment so the two pickers feel
            like one feature. Tapping an episode sets `activeEpisodeId`
            globally; the next visit to the Story tab drills into that
            episode rather than the grid. Only mounted when TV + at
            least one episode exists, so non-TV projects never pay for
            the portal. */}
        {isTV && (activeStoryLayer.episodes?.length ?? 0) > 0 && typeof document !== "undefined" && createPortal(
          <>
            <div
              className={`sheet-backdrop ${episodeSheetOpen ? "open" : ""}`}
              onClick={() => setEpisodeSheetOpen(false)}
            />
            <div className={`sheet draft-sheet ${episodeSheetOpen ? "open" : ""}`}>
              <div className="sheet-handle" />
              <div className="sheet-body">
                {(activeStoryLayer.episodes ?? []).map(ep => {
                  const effectiveActiveId =
                    activeEpisodeId ?? activeStoryLayer.episodes?.[0]?.id;
                  const isActive = ep.id === effectiveActiveId;
                  return (
                    <button
                      key={ep.id}
                      className={`drafts-dropdown-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        setActiveEpisodeId(ep.id);
                        setEpisodeSheetOpen(false);
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                          <span>Episode {ep.number}</span>
                          <span className="drafts-dropdown-date">
                            {ep.beats.length} {ep.beats.length === 1 ? "scene" : "scenes"}
                          </span>
                        </div>
                        <span style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 400 }}>
                          {ep.title}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {/* Make the show-vs-episode scope explicit. Concept and
                    Characters live at the project level, so they apply
                    across every episode automatically — adding a new
                    episode doesn't fork them. Only the Story (beats)
                    and Script differ per-episode. */}
                <div
                  className="caption"
                  style={{ padding: "12px 4px 4px", opacity: 0.7, lineHeight: 1.4 }}
                >
                  Concept and Characters are shared across all episodes.
                  Each episode has its own Story beats and Script.
                </div>
              </div>
              <div className="sheet-sticky-footer">
                <div className="draft-sheet-actions">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => {
                      const newEpisodeId = "ep_" + Math.random().toString(36).slice(2);
                      setStory(s => {
                        const ad = getActiveStoryLayerDraft(s);
                        const nextNumber = (ad.episodes?.length ?? 0) + 1;
                        return updateStoryLayerDraft(s, {
                          episodes: [
                            ...(ad.episodes ?? []),
                            {
                              id: newEpisodeId,
                              title: `Episode ${nextNumber}`,
                              number: nextNumber,
                              beats: [],
                            },
                          ],
                        });
                      });
                      setActiveEpisodeId(newEpisodeId);
                      setEpisodeSheetOpen(false);
                    }}
                    style={{ flex: 1 }}
                    icon={
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <rect x="3.5" width="2" height="9" />
                        <rect y="5.5" width="2" height="9" transform="rotate(-90 0 5.5)" />
                      </svg>
                    }
                  >
                    New Episode
                  </Button>
                </div>
              </div>
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
                /* `key={section}` forces React to unmount/remount the
                    wrapper on section change. That re-triggers the
                    `.tab-content-wrap` CSS animation (defined in
                    globals.css) every time the user switches tabs,
                    giving Concept → Characters → Story → Script a
                    short, snappy fade-up transition instead of a
                    hard cut. */
                key={section}
                style={{ padding: "8px 22px 40px" }}
                className={`tab-content-wrap tab-content-wrap-${section}${previewActive ? " partner-preview-locked" : ""}`}
                aria-hidden={previewActive ? true : undefined}
              >
          {section === "concept" && (
            <ConceptTab
              story={tabStory}
              setStory={tabSetStory}
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
              activeEpisodeId={activeEpisodeId}
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
              activeEpisodeId={activeEpisodeId}
              charsInFlight={charsInFlight}
            />
          )}
          {section === "story" && (
            <StoryTab
              story={tabStory}
              setStory={tabSetStory}
              beats={tabBeats}
              moments={moments}
              moveBeat={moveBeat}
              openExistingScene={openExistingSceneSheet}
              openScenePopup={(id: string) => {
                setScenePopupVariant("story");
                setScenePopupBeatId(id);
              }}
              openNewScene={openNewSceneSheet}
              run={run}
              busy={busy}
              syncState={syncState}
              autosaveEnabled={autosaveEnabled}
              onOpenUpdateTray={setUpdateTraySource}
              runGenerateAll={runGenerateAll}
              scenesInFlight={scenesInFlight}
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
              scenesInFlight={scenesInFlight}
              charsInFlight={charsInFlight}
              onEditScene={openExistingSceneSheet}
              onImportScript={importScriptFromFile}
              onImportPastedScript={importScriptFromText}
              onImportStoryDescription={importStoryFromDescription}
              importing={importing}
              importStep={importStep}
              onAddScene={() => {
                // Scene (beat) creation lives on the Story tab. Switch
                // over and open the unified scene sheet appending at
                // the end so the user lands exactly where they expect.
                setSection("story");
                openNewSceneSheet(sorted.length);
              }}
              onGoToStory={() => setSection("story")}
              openScenePopup={(id: string) => {
                setScenePopupVariant("script-unwritten");
                setScenePopupBeatId(id);
              }}
              openScriptViewSheet={(id: string) => setScriptViewBeatId(id)}
              /* Desktop HM button on the right pane fires this opener
                 to enter the ScriptViewSheet's drag-highlight flow
                 directly. Sets initialHighlightOn first so the sheet
                 mounts with highlight mode already on — the same path
                 the Read-through sheet uses for its highlight entry. */
              openScriptViewSheetHighlight={(id: string) => {
                setScriptViewInitialHighlight(true);
                setScriptViewBeatId(id);
              }}
              bgScriptJob={bgScriptJob}
              onStartBackgroundScriptLoop={onStartBackgroundScriptLoop}
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

      {/* v2 scene preview popup — surfaces when the user taps an
          already-saved beat row in the Story tab. The Edit Scene
          button hands off to the full sheet below. */}
      {(() => {
        const popupOpen = scenePopupBeatId !== null;
        if (!popupOpen) return null;
        const idx = beats.findIndex(b => b.id === scenePopupBeatId);
        const beat = idx >= 0 ? beats[idx] : null;
        if (!beat) return null;
        const total = beats.length;
        const cast = getActiveCharactersDraft(story).characters;
        const beatChars = (beat.characterIds ?? [])
          .map(id => cast.find(c => c.id === id))
          .filter((c): c is Character => !!c);
        // Rough estimated duration from sceneContent length —
        // 250 words/min is the screenplay-page convention. Falls
        // back to "—:—" when no scene prose has been written yet.
        const wordCount = (beat.sceneContent || "").trim().split(/\s+/).filter(Boolean).length;
        const durationLabel = wordCount > 0
          ? (() => {
              const seconds = Math.max(1, Math.round((wordCount / 250) * 60));
              const m = Math.floor(seconds / 60);
              const s = seconds % 60;
              return `${m}:${s.toString().padStart(2, "0")}`;
            })()
          : "—:—";
        const closePopup = () => setScenePopupBeatId(null);
        const goPrev = () => { if (idx > 0) setScenePopupBeatId(beats[idx - 1].id); };
        const goNext = () => { if (idx < total - 1) setScenePopupBeatId(beats[idx + 1].id); };
        const goEdit = () => {
          setScenePopupBeatId(null);
          openExistingSceneSheet(beat.id);
        };
        return (
          <div
            className={`scene-popup-scrim open scene-popup-variant-${scenePopupVariant}`}
            role="dialog"
            aria-modal="true"
            onClick={closePopup}
          >
            <div className="scene-popup-card" onClick={e => e.stopPropagation()}>
              <div className="scene-popup-image">
                {/* In-flight FIRST — regenerate visibly replaces the
                    existing image with shimmer. */}
                {scenesInFlight.has(beat.id)
                  ? <div className="scene-popup-image-placeholder ds-image-shimmer is-dark" aria-label="Generating scene image" />
                  : beat.thumbnail
                    ? <img src={beat.thumbnail} alt="" />
                    : <div className="scene-popup-image-placeholder" aria-hidden="true" />}
                <button
                  type="button"
                  className="scene-popup-close"
                  onClick={closePopup}
                  aria-label="Close preview"
                >
                  <img src="/icon-add-cta.svg" alt="" aria-hidden="true" />
                </button>
                <div className="scene-popup-duration ds-type-body">
                  <img src="/icon-duration.svg" alt="" aria-hidden="true" />
                  <span>{durationLabel}</span>
                </div>
              </div>
              <div className="scene-popup-body">
                <span className="scene-popup-index ds-type-main-tab-nav-inactive">
                  SCENE {idx + 1} OF {total}
                </span>
                <div className="scene-popup-name ds-type-project-card-title">
                  {beat.name || "Untitled scene"}
                </div>
                <p className="scene-popup-summary ds-type-body">
                  {beat.summary || "No summary yet."}
                </p>
                {beatChars.length > 0 && (
                  <div className="scene-popup-characters" aria-label="Characters in this scene">
                    {beatChars.map(c => (
                      charsInFlight.has(c.id)
                        ? <div key={c.id} className="scene-popup-avatar ds-image-shimmer is-dark" aria-label="Generating character portrait" />
                        : c.thumbnail
                          ? <img key={c.id} src={c.thumbnail} alt="" className="scene-popup-avatar" />
                          : <div key={c.id} className="scene-popup-avatar scene-popup-avatar-placeholder">
                              {c.name ? c.name[0].toUpperCase() : "?"}
                            </div>
                    ))}
                  </div>
                )}
                {scenePopupVariant === "script-unwritten" ? (
                  /* Opened from the Script tab on an unwritten beat
                     — replace the read-mode footer with a single
                     primary Script Scene CTA. Same generate action
                     the per-row chip fires; closes the popup so the
                     in-flight scene shows up in the row's spinner
                     state immediately. */
                  <button
                    type="button"
                    className="scene-popup-script-cta"
                    onClick={() => {
                      const beatIndex = beats.findIndex(b => b.id === beat.id);
                      if (beatIndex < 0) return;
                      setScenePopupBeatId(null);
                      run(
                        { type: "generate_scene", payload: { beatIndex } },
                        `Write · ${beat.name}`,
                      );
                    }}
                  >
                    <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
                    <span>Script Scene</span>
                  </button>
                ) : (
                  <div className="scene-popup-edit-row">
                    <button
                      type="button"
                      className="scene-popup-edit"
                      onClick={goEdit}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                      <span>EDIT SCENE</span>
                    </button>
                    <button
                      type="button"
                      className="scene-popup-nav-edge prev"
                      onClick={goPrev}
                      disabled={idx === 0}
                      aria-label="Previous scene"
                    >
                      <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, stroke: "currentColor", strokeWidth: 1.8, fill: "none" }} aria-hidden="true">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="scene-popup-nav-edge next"
                      onClick={goNext}
                      disabled={idx === total - 1}
                      aria-label="Next scene"
                    >
                      <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, stroke: "currentColor", strokeWidth: 1.8, fill: "none" }} aria-hidden="true">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* v2 Script View sheet — see ScriptViewSheet for full notes.
          Renders all written scenes stacked with active-scene
          tracking + inline highlight + composer. Closing nulls
          the seed beat so the next open starts fresh. */}
      <ScriptViewSheet
        open={scriptViewBeatId !== null}
        story={story}
        setStory={setStory}
        onClose={() => {
          setScriptViewBeatId(null);
          // Reset the initial-highlight seed so a subsequent open
          // (e.g. via a card tap on mobile) starts in read mode.
          setScriptViewInitialHighlight(false);
        }}
        initialBeatId={scriptViewBeatId}
        initialHighlightOn={scriptViewInitialHighlight}
      />

      {/* Scene sheet — single sheet for both creation and editing,
          mirroring the character-sheet pattern below. Sheet title
          reflects whether the scene already has a name. */}
      {(() => {
        const open = sceneSheetBeatId !== null;
        const activeBeat = open
          ? beats.find(b => b.id === sceneSheetBeatId)
          : null;
        return (
          <>
            <div className={`sheet-backdrop ${open ? "open" : ""}`}
              onClick={closeSceneSheet} />
            <div className={`sheet sheet-tall ${open ? "open" : ""}`}>
              <div className="sheet-handle" />
              <div className="sheet-header">
                <div className="sheet-title">
                  {activeBeat?.name?.trim() || "New scene"}
                </div>
                <Button variant="secondary" size="sm" onClick={closeSceneSheet}>Close</Button>
              </div>
              <div className="sheet-body" style={{ whiteSpace: "normal" }}>
                {activeBeat && (
                  <SceneEditForm
                    beat={activeBeat}
                    story={story}
                    moments={moments}
                    isNew={sceneSheetIsNew}
                    autoGenInFlight={scenesInFlight.has(activeBeat.id)}
                    onUpdate={(patch) => updateBeat(activeBeat.id, patch)}
                    onRemove={() => {
                      removeBeat(activeBeat.id);
                      setSceneSheetBeatId(null);
                    }}
                  />
                )}
              </div>
              <div className="sheet-sticky-footer">
                <Button
                  variant="primary"
                  size="lg"
                  block
                  onClick={closeSceneSheet}
                >
                  Save
                </Button>
              </div>
            </div>
          </>
        );
      })()}

      {/* Character sheet — single sheet for both creation and editing.
          Sheet title reflects whether the character already has a name. */}
      {(() => {
        const open = charSheetCharId !== null;
        const activeChar = open
          ? getActiveCharactersDraft(story).characters.find(c => c.id === charSheetCharId)
          : null;
        // Cross-episode lock: a character belongs to the episode it was
        // created in. Viewing it from any other episode renders the form
        // read-only — same `.partner-preview-locked` wrapper the partner-
        // preview flow uses, so the visual treatment (dim + pointer-
        // events:none) is consistent. A small banner above the form
        // tells the user where to go to edit.
        const charCreatedInId = activeChar?.createdInEpisodeId;
        const effectiveCharEpisodeId =
          activeEpisodeId ?? activeStoryLayer.episodes?.[0]?.id ?? null;
        const charOwnerEpisode = isTV && charCreatedInId
          ? activeStoryLayer.episodes?.find(ep => ep.id === charCreatedInId) ?? null
          : null;
        const isCharLocked = isTV
          && !!charCreatedInId
          && !!effectiveCharEpisodeId
          && charCreatedInId !== effectiveCharEpisodeId;
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
                {isCharLocked && charOwnerEpisode && (
                  <div
                    className="caption"
                    style={{
                      padding: "10px 12px",
                      marginBottom: 12,
                      background: "var(--surface-2, #f3f3f4)",
                      borderRadius: 10,
                      lineHeight: 1.4,
                    }}
                  >
                    Locked — this character was created in Episode {charOwnerEpisode.number}{charOwnerEpisode.title ? ` (“${charOwnerEpisode.title}”)` : ""}. Switch to that episode to edit or delete it.
                  </div>
                )}
                {activeChar && (
                  <div className={isCharLocked ? "partner-preview-locked" : undefined}>
                    <CharacterEditForm
                      character={activeChar}
                      story={story}
                      isNew={charSheetIsNew || isCharLocked}
                      autoGenInFlight={charsInFlight.has(activeChar.id)}
                      onUpdate={(patch) => {
                        if (isCharLocked) return;
                        setStory(s => updateCharactersDraft(s, {
                          characters: getActiveCharactersDraft(s).characters.map(c =>
                            c.id === activeChar.id ? { ...c, ...patch } : c
                          ),
                        }));
                      }}
                      onRemove={() => {
                        if (isCharLocked) return;
                        setStory(s => updateCharactersDraft(s, {
                          characters: getActiveCharactersDraft(s).characters.filter(c => c.id !== activeChar.id),
                        }));
                        setCharSheetCharId(null);
                      }}
                    />
                  </div>
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
        onClose={() => {
          setReadThroughOpen(false);
          // Clear the deep-link initializers so a subsequent
          // open (from the layer-bar Read-through chip, etc.)
          // gets a fresh non-scrolled, highlight-off state.
          setReadThroughInitialBeatId(null);
          setReadThroughInitialHighlight(false);
        }}
        initialBeatId={readThroughInitialBeatId}
        initialHighlightOn={readThroughInitialHighlight}
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

  // Sliding underline (desktop). useLayoutEffect measures the active
  // tab's position inside the bar after each render and writes
  // `--underline-x` + `--underline-w` to the bar's style. The
  // `.studio-tab-underline` element below uses those CSS variables
  // with a transition on `left` and `width` — so the bar smoothly
  // moves from one tab to the next instead of cutting. The +/−65
  // span / -25 offset replicates the existing per-tab `::after`
  // geometry (left: -25 / right: -40 on the active tab).
  //
  // useLayoutEffect (not useEffect) runs before paint so the first
  // paint after a section change already has the new coordinates;
  // no flash of mispositioned underline. The resize listener keeps
  // the underline aligned if the viewport changes (e.g. devtools
  // open / close).
  const barRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const active = bar.querySelector(".studio-tab.active") as HTMLElement | null;
      if (!active) return;
      const barRect = bar.getBoundingClientRect();
      const tabRect = active.getBoundingClientRect();
      const left = tabRect.left - barRect.left - 25;
      const width = tabRect.width + 65;
      bar.style.setProperty("--underline-x", `${left}px`);
      bar.style.setProperty("--underline-w", `${width}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [section]);

  return (
    <div className="studio-tab-bar" ref={barRef}>
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
            data-section={t.key}
            onClick={() => setSection(t.key)}
          >
            {/* Selection box — 73×71 centered behind the icon/label
                of the active tab. Always rendered, hidden via CSS
                except on .active so we don't have to track another
                conditional in JSX. */}
            <span className="studio-tab-bg" aria-hidden="true" />
            <span className={`studio-tab-label ${section === t.key ? "ds-type-project-tab-nav-active" : "ds-type-project-tab-nav-inactive"}`}>{t.label}</span>
            {dot && <span className="sync-dot" />}
          </button>
        );
      })}
      {/* Sliding underline indicator (desktop only — CSS gates
          `display`). Position + width driven by the `--underline-x`
          / `--underline-w` CSS variables set by the measurement
          effect above. Replaces the per-tab `::after` so the
          underline moves continuously between tabs instead of
          disappearing on the old tab and reappearing on the new. */}
      <span className="studio-tab-underline" aria-hidden="true" />
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
      <div className="topbar-center" style={{ textAlign: "center", flex: 1, position: "static", transform: "none" }}>
        <div className="topbar-title" style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-0.01em" }}>
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
        <span className="layer-draft-label ds-type-draft-dropdown">{label} Draft {active.number}</span>
        <img src="/icon-draft-dropdown-caret.svg" alt="" className={`drafts-caret ${open ? "open" : ""}`} />
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
/* ── Active-draft owner initial ──
 * Single outlined circle rendered on the LEFT of each LayerBar's draft
 * dropdown. Displays the initial of whoever owns the DRAFT currently
 * loaded in this layer — the viewer normally, the partner while in
 * partner-preview for this layer. Hidden on solo projects.
 *
 * `layer` identifies which bar we're in so we can compare against
 * `previewLayer` from context — a global `isPartnerPreviewing` flag
 * would incorrectly badge non-previewed tabs as partner-owned. */
function ActiveDraftInitial({ layer }: { layer: LayerKey }) {
  const {
    partnerStory,
    creatorEmail,
    inviteeEmail,
    creatorDisplayName,
    inviteeDisplayName,
    myEmail,
    myDisplayName,
    partnerEmail,
    previewLayer,
  } = usePartnerIdentity();
  // Solo projects: nothing to distinguish, so skip the chip.
  if (!partnerStory) return null;

  const showingPartner = previewLayer === layer;

  // Resolve partner's display name from canonical project-members data
  // when possible: whichever side of (creator, invitee) ISN'T the
  // viewer is the partner.
  const partnerDisplayName =
    creatorEmail && creatorEmail === myEmail
      ? (inviteeDisplayName ?? null)
      : inviteeEmail && inviteeEmail === myEmail
      ? (creatorDisplayName ?? null)
      : null;

  const ownerName = showingPartner ? partnerDisplayName : myDisplayName ?? null;
  const ownerEmail = showingPartner ? (partnerEmail ?? null) : (myEmail ?? null);
  const ch = letterOrNull(ownerName, ownerEmail);
  if (!ch) return null;
  return <span className="layer-owner-initial" aria-hidden="true">{ch}</span>;
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
  rightSlot,
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
  /** Optional content rendered at the right end of the layer-bar.
   *  Used by CharactersTab to host the Add/Auto-Create button pair on
   *  the same row as the draft trigger. The slot pushes itself right
   *  via margin-left: auto in CSS so it sits flush with the bar's
   *  right edge regardless of which siblings are present. */
  rightSlot?: React.ReactNode;
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
          aria-label="Read mode"
          title="Open read mode"
        >
          <ReadIcon />
          <span>Read Mode</span>
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
          <img src="/icon-draft-dropdown-caret.svg" alt="" className="drafts-caret" />
        </button>
      )}
      {rightSlot && <div className="layer-bar-right-slot">{rightSlot}</div>}
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
        <img src="/icon-draft-dropdown-caret.svg" alt="" className={`drafts-caret ${open ? "open" : ""}`} />
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
        <img src="/icon-draft-dropdown-caret.svg" alt="" className={`drafts-caret ${open ? "open" : ""}`} />
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
  // adjacent Update-Other-Layers chevron. 14px so the icon reads inside
  // the larger solid-black "Read Mode" pill.
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
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
  initialBeatId,
  initialHighlightOn,
}: {
  open: boolean;
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  onClose: () => void;
  /** Optional beat to scroll to when the sheet opens. Used by the
   *  Script View sheet's pencil button so the user lands on the
   *  scene they were just reading. */
  initialBeatId?: string | null;
  /** When true, highlight mode is pre-enabled on open — the user
   *  goes straight to "select text + edit with AI" without having
   *  to tap the Highlight toggle. */
  initialHighlightOn?: boolean;
}) {
  const charactersDraft = getActiveCharactersDraft(story);
  const conceptDraft = getActiveConceptDraft(story);
  const title = story.title || "Untitled";

  // Read-through scenes are derived from beats[i].sceneContent — the
  // bucket the Script tab actually renders from. The historical
  // scriptDraft.script.scenes path is orphaned legacy data from the
  // pre-fix sync_*_to_script flow; reading from it here was why the
  // sheet showed "No scenes…" for projects whose prose lived only on
  // beats. We use beat.id as scene.id so highlight rects + the
  // submitComposer write-back can map back to the source beat.
  const sl = getActiveStoryLayerDraft(story);
  const flatBeats: Beat[] = sl
    ? story.projectType === "tv-show"
      ? (sl.episodes ?? []).flatMap(ep => ep.beats)
      : sl.beats
    : [];
  const scenes: Scene[] = flatBeats
    .filter(b => b.status === "written" && b.sceneContent?.trim())
    .map(b => ({
      id: b.id,
      beatId: b.id,
      heading: b.name,
      content: b.sceneContent ?? "",
      notes: "",
    }));

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

  // Wire up `initialBeatId` + `initialHighlightOn` props. Both fire
  // ONCE per `open` transition (false → true) so we don't keep
  // re-toggling state if the parent passes stable props. Scrolling
  // is deferred a tick so the sheet's slide-up animation lays out
  // the scene anchors first.
  useEffect(() => {
    if (!open) return;
    if (initialHighlightOn) setHighlightMode(true);
    if (initialBeatId) {
      const t = setTimeout(() => {
        const anchor = bodyRef.current?.querySelector<HTMLElement>(`[data-scene-id="${initialBeatId}"]`);
        if (anchor && bodyRef.current) {
          // Scroll to anchor inside the sheet body (not the
          // window) so the rest of the page geometry stays put.
          const top = anchor.offsetTop - bodyRef.current.offsetTop;
          bodyRef.current.scrollTop = Math.max(0, top - 12);
        }
      }, 380);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      // Splice into the source beat. scene.id === beat.id (we built
      // the scenes array from beats above), so we match by id and
      // overwrite that beat's sceneContent. The Script tab and any
      // future re-render of the read-through both source from beats,
      // so this single write is observable everywhere. We replace the
      // FIRST occurrence of the selected text — in practice the
      // highlighted text is unlikely to appear verbatim twice in one
      // scene. If it does, the first match wins; users can re-run the
      // highlighter on the second instance.
      const sid = activeHighlight.sceneId;
      const needle = activeHighlight.text;
      setStory((s) => {
        const sl = getActiveStoryLayerDraft(s);
        if (!sl) return s;
        const writeInto = (arr: Beat[]): Beat[] => arr.map(b =>
          b.id === sid && b.sceneContent
            ? { ...b, sceneContent: replaceFirst(b.sceneContent, needle, replacement) }
            : b,
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

/* ============================================ */
/* ============ SCRIPT VIEW SHEET ============== */
/* ============================================ */

/**
 * Per-scene script reader/editor opened from the v2 Script tab when
 * a written scene row is tapped. Renders ALL written scenes stacked
 * in one scrollable body — the user reads from one scene right into
 * the next without remounting the sheet. The header at the top
 * stays pinned and updates its title/slug/count based on which
 * scene is currently most visible (tracked via IntersectionObserver).
 * Prev/next chevrons are jump-anchors that smooth-scroll to the
 * adjacent written scene.
 *
 * The pencil button toggles a local highlight mode — same drag-to-
 * highlight + "Change with AI" composer flow used by the legacy
 * ReadThroughSheet, ported inline so the user never leaves this
 * sheet to make a single-line rewrite. Submit hits the same
 * `/api/generate` action (`rewrite_highlighted_range`) and splices
 * the AI replacement directly into the beat's sceneContent.
 */
function ScriptViewSheet({
  open,
  story,
  setStory,
  onClose,
  initialBeatId,
  initialHighlightOn,
}: {
  open: boolean;
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  onClose: () => void;
  /** Optional beat to land on when the sheet opens. */
  initialBeatId?: string | null;
  /** When true, the sheet opens with the drag-to-highlight mode
   *  pre-armed (matches the ReadThroughSheet's same prop). Fired
   *  by the desktop Script tab's HM button on the right pane so
   *  the user enters the highlight flow with one click. */
  initialHighlightOn?: boolean;
}) {
  const charactersDraft = getActiveCharactersDraft(story);
  const conceptDraft = getActiveConceptDraft(story);

  const sl = getActiveStoryLayerDraft(story);
  const flatBeats: Beat[] = sl
    ? story.projectType === "tv-show"
      ? (sl.episodes ?? []).flatMap(ep => ep.beats)
      : sl.beats
    : [];
  const writtenBeats = flatBeats.filter(
    b => b.status === "written" && b.sceneContent?.trim(),
  );

  // Active scene index = the one most-visible in the scrollable
  // body. Updated by IntersectionObserver below.
  const [activeIdx, setActiveIdx] = useState(0);

  // Highlight state — identical shape to ReadThroughSheet's. Yellow
  // overlay rects are stored in body-local coordinates so scroll
  // doesn't drift them.
  const [highlightMode, setHighlightMode] = useState(false);
  const [activeHighlight, setActiveHighlight] =
    useState<ReadThroughHighlight | null>(null);
  const [dragRects, setDragRects] = useState<
    ReadThroughHighlight["rects"] | null
  >(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // When the sheet is opened with `initialHighlightOn`, seed the
  // local toggle. Fires once per open transition: when `open` flips
  // false → true, copy the seed into local state. Closing the sheet
  // clears highlight mode so the next non-highlight open is clean.
  useEffect(() => {
    if (open) {
      if (initialHighlightOn) setHighlightMode(true);
    } else {
      setHighlightMode(false);
      setActiveHighlight(null);
      setDragRects(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Composer state.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInstruction, setComposerInstruction] = useState("");
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const composerOpenRef = useRef(false);
  useEffect(() => { composerOpenRef.current = composerOpen; }, [composerOpen]);

  // Track on-screen keyboard so the composer pins flush above it.
  useEffect(() => {
    if (!composerOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setKeyboardBottomInset(inset);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [composerOpen]);

  // Reset composer state whenever it opens/closes.
  useEffect(() => {
    if (composerOpen) {
      setComposerInstruction("");
      setComposerError(null);
      setTimeout(() => { composerInputRef.current?.focus(); }, 60);
    } else {
      setComposerError(null);
    }
  }, [composerOpen]);

  // Reset state when the sheet closes / highlight mode goes off.
  useEffect(() => {
    if (!open || !highlightMode) {
      setActiveHighlight(null);
      setDragRects(null);
    }
  }, [open, highlightMode]);

  // On open, scroll to the initial beat if requested.
  useEffect(() => {
    if (!open) return;
    if (!initialBeatId) return;
    const t = setTimeout(() => {
      const host = bodyRef.current;
      if (!host) return;
      const anchor = host.querySelector<HTMLElement>(`[data-scene-id="${initialBeatId}"]`);
      if (anchor) {
        host.scrollTop = Math.max(0, anchor.offsetTop - 12);
      }
      const idx = writtenBeats.findIndex(b => b.id === initialBeatId);
      if (idx >= 0) setActiveIdx(idx);
    }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialBeatId]);

  // Active-scene tracking — set the most-visible scene as active.
  useEffect(() => {
    if (!open) return;
    const host = bodyRef.current;
    if (!host) return;
    const obs = new IntersectionObserver(
      (entries) => {
        let best: { idx: number; ratio: number } | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = (e.target as HTMLElement).dataset.sceneId;
          if (!id) continue;
          const idx = writtenBeats.findIndex(b => b.id === id);
          if (idx < 0) continue;
          if (!best || e.intersectionRatio > best.ratio) {
            best = { idx, ratio: e.intersectionRatio };
          }
        }
        if (best) setActiveIdx(best.idx);
      },
      { root: host, threshold: [0.15, 0.35, 0.55, 0.75] },
    );
    host.querySelectorAll<HTMLElement>("[data-scene-id]").forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [open, writtenBeats.length]);

  // Submit the composer's instruction against the activeHighlight.
  // Mirrors ReadThroughSheet.submitComposer — same API action,
  // same write-back path.
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
          } catch { /* ignore */ }
        }
      }
      const replacement = parseReplacement(fullText);
      if (!replacement) throw new Error("AI returned no replacement text.");
      const sid = activeHighlight.sceneId;
      const needle = activeHighlight.text;
      setStory((s) => {
        const sl2 = getActiveStoryLayerDraft(s);
        if (!sl2) return s;
        const writeInto = (arr: Beat[]): Beat[] => arr.map(b =>
          b.id === sid && b.sceneContent
            ? { ...b, sceneContent: replaceFirst(b.sceneContent, needle, replacement) }
            : b,
        );
        if (s.projectType === "tv-show") {
          return updateStoryLayerDraft(s, {
            episodes: (sl2.episodes ?? []).map(ep => ({ ...ep, beats: writeInto(ep.beats) })),
          });
        }
        return updateStoryLayerDraft(s, { beats: writeInto(sl2.beats) });
      });
      setComposerOpen(false);
      setActiveHighlight(null);
      setHighlightMode(false);
    } catch (e) {
      setComposerError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setComposerBusy(false);
    }
  }

  // Walk up from `node` to find the enclosing [data-scene-id].
  function sceneIdForNode(node: Node): string | null {
    let el: Node | null = node;
    while (el) {
      if (el instanceof HTMLElement && el.dataset.sceneId) return el.dataset.sceneId;
      el = el.parentNode;
    }
    return null;
  }
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

  // selectionchange-driven highlighter — same approach as
  // ReadThroughSheet. Native long-press-and-drag selects, then we
  // capture the rects, render our own yellow overlay, and clear
  // the native selection after a debounce.
  const commitTimerRef = useRef<number | null>(null);
  const weClearedSelectionRef = useRef(false);
  useEffect(() => {
    if (!highlightMode) {
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
        if (weClearedSelectionRef.current) {
          weClearedSelectionRef.current = false;
          return;
        }
        setDragRects(null);
        if (!composerOpenRef.current) setActiveHighlight(null);
        return;
      }
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      if (!anchor || !focus) return;
      if (!el.contains(anchor) || !el.contains(focus)) return;
      const anchorSceneId = sceneIdForNode(anchor);
      if (!anchorSceneId) return;
      const focusSceneId = sceneIdForNode(focus);
      let useRange: Range;
      if (focusSceneId === anchorSceneId) {
        useRange = sel.getRangeAt(0).cloneRange();
      } else {
        const sceneEl = el.querySelector<HTMLElement>(`[data-scene-id="${anchorSceneId}"]`);
        if (!sceneEl) return;
        const walker = document.createTreeWalker(sceneEl, NodeFilter.SHOW_TEXT);
        let last: Text | null = null;
        while (walker.nextNode()) last = walker.currentNode as Text;
        if (!last) return;
        useRange = document.createRange();
        try {
          useRange.setStart(anchor, sel.anchorOffset);
          useRange.setEnd(last, last.length);
        } catch { return; }
      }
      const text = useRange.toString();
      if (text.trim().length < 2) {
        setDragRects(null);
        return;
      }
      const localRects = toLocalRects(Array.from(useRange.getClientRects()));
      setDragRects(localRects);
      setActiveHighlight({ sceneId: anchorSceneId, text, rects: localRects });
      if (commitTimerRef.current != null) window.clearTimeout(commitTimerRef.current);
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

  function scrollToScene(beatId: string) {
    const host = bodyRef.current;
    if (!host) return;
    const el = host.querySelector<HTMLElement>(`[data-scene-id="${beatId}"]`);
    if (!el) return;
    host.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: "smooth" });
  }
  const goPrev = () => { if (activeIdx > 0) scrollToScene(writtenBeats[activeIdx - 1].id); };
  const goNext = () => { if (activeIdx < writtenBeats.length - 1) scrollToScene(writtenBeats[activeIdx + 1].id); };

  const activeBeat = writtenBeats[activeIdx] ?? null;
  const slug = (() => {
    if (!activeBeat) return "SCENE";
    const m = (activeBeat.sceneContent || "").match(/^\s*(?:INT\.?|EXT\.?|INT\.?\/EXT\.?)\s+[^\n]+/im);
    return (m?.[0] ?? "SCENE").trim().toUpperCase();
  })();

  const rectsToShow = dragRects ?? activeHighlight?.rects ?? null;
  const fullSceneText = activeBeat
    ? [activeBeat.name, activeBeat.sceneContent].filter(Boolean).join("\n\n")
    : "";

  return (
    <>
      <div className={`sheet-backdrop ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`sheet sheet-tall script-view-sheet ${open ? "open" : ""}`}>
        <div className="sheet-handle" />
        {/* Close button — same top-right position the scene edit
            sheet uses, but absolute-positioned so it doesn't
            interfere with the centered title/slug stack below. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={onClose}
          className="script-view-close-btn"
        >
          Close
        </Button>
        <div className="script-view-header">
          <div className="script-view-count ds-type-main-tab-nav-inactive">
            SCENE {activeIdx + 1} OF {Math.max(1, writtenBeats.length)}
          </div>
          <div className="script-view-title-row">
            <button
              type="button"
              className="script-view-nav-btn"
              onClick={goPrev}
              disabled={activeIdx === 0}
              aria-label="Previous scene"
            >
              <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, stroke: "currentColor", strokeWidth: 1.8, fill: "none" }} aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="script-view-title-stack">
              <div className="script-view-name ds-type-project-card-title">
                {activeBeat?.name || "Untitled scene"}
              </div>
              <div className="script-view-slug ds-type-int-header">{slug}</div>
            </div>
            <button
              type="button"
              className="script-view-nav-btn"
              onClick={goNext}
              disabled={activeIdx >= writtenBeats.length - 1}
              aria-label="Next scene"
            >
              <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, stroke: "currentColor", strokeWidth: 1.8, fill: "none" }} aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
        <div className="script-view-actions">
          <button
            type="button"
            className={`script-view-action-btn ${highlightMode ? "active" : ""}`}
            onClick={() => setHighlightMode(v => !v)}
            aria-pressed={highlightMode}
            aria-label={highlightMode ? "Exit highlight mode" : "Highlight & edit with AI"}
            title={highlightMode ? "Exit highlight mode" : "Highlight & edit with AI"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <SpeakButton
            mode="script"
            size="md"
            text={fullSceneText}
            characters={charactersDraft.characters}
            projectType={story.projectType}
            genres={conceptDraft.settings.genres}
            title="Read scene aloud"
          />
        </div>
        <div
          ref={bodyRef}
          className={`script-view-body ${highlightMode ? "highlighting" : ""}`}
          tabIndex={0}
        >
          {rectsToShow && rectsToShow.length > 0 && (
            <div className="read-through-hl-layer" aria-hidden>
              {rectsToShow.map((r, i) => (
                <div
                  key={i}
                  className="read-through-hl-rect"
                  style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
                />
              ))}
            </div>
          )}
          {writtenBeats.length === 0 ? (
            <div className="caption" style={{ textAlign: "center", padding: "40px 20px" }}>
              No written scenes yet.
            </div>
          ) : (
            writtenBeats.map(beat => (
              <div key={beat.id} className="script-view-scene-block" data-scene-id={beat.id}>
                <pre className="script-view-prose">{beat.sceneContent}</pre>
              </div>
            ))
          )}
        </div>
        {activeHighlight && !composerOpen && (
          <button
            type="button"
            className="read-through-hl-cta"
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={() => setComposerOpen(true)}
          >
            Change with AI
          </button>
        )}
      </div>
      {composerOpen && activeHighlight && (
        <>
          <div
            className="read-through-composer-backdrop"
            onClick={() => { if (!composerBusy) setComposerOpen(false); }}
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
  noToggle,
  note,
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
  /** Free-form direction text to display under the pills when the row
   *  is collapsed. Used by Tone/Themes/Framework/Ending to surface the
   *  user's "elaborate in your own words" note as a preview, so they
   *  don't need to expand the row to recall what they wrote. */
  note?: string;
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
  /** Cross-episode lock (TV, non-pilot episode). When set, the row is
   *  rendered as a header-only display: caret is hidden, body never
   *  expands, and tapping the header invokes this callback (used to
   *  surface a toast explaining the lock). Takes precedence over
   *  `readOnly` since the two locks are mutually exclusive in
   *  practice. */
  noToggle?: () => void;
}) {
  const hasValues = values && values.length > 0;
  const suppressControls = (readOnly || !!noToggle) && !hasValues;
  const isLockedDisplay = !!noToggle;
  // Header is non-interactive only when the row is read-only with no
  // values to display. Otherwise it's a clickable target. Rendered as
  // <div role="button"> rather than <button> so the inner AIWandButton
  // (and the partner-copy button) aren't nested inside another button —
  // browsers split nested buttons inconsistently, causing intermittent
  // clicks on the inner control.
  const interactive = isLockedDisplay || !suppressControls;
  const headerClick = () => {
    if (!interactive) return;
    if (isLockedDisplay) { noToggle!(); return; }
    onToggle();
  };
  return (
    <div className="attr-row" data-label={label}>
      <div
        className="attr-row-header"
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-disabled={!interactive || undefined}
        onClick={headerClick}
        onKeyDown={interactive ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            headerClick();
          }
        } : undefined}
      >
        <span className="attr-label ds-type-attribute-title">
          {label}
          {/* AI wand hidden in readOnly (partner-preview) rows —
              there's nothing to generate into someone else's draft. */}
          {ai && !readOnly && !isLockedDisplay && <AIWandButton onClick={ai} loading={!!aiLoading} />}
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
            : <span className="attr-placeholder">{(readOnly || isLockedDisplay) ? "None added" : (placeholder || "Not set")}</span>
          }
        </div>
        {!readOnly && !isLockedDisplay && !suppressControls && (
          <svg className={`attr-caret ${expanded ? "open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        )}
      </div>
      {!expanded && note && note.trim() && (
        <div
          className="attr-row-note-preview"
          onClick={interactive ? headerClick : undefined}
        >
          {note}
        </div>
      )}
      {expanded && !isLockedDisplay && (
        <div className="attr-row-body">
          {readOnly ? (
            <div className="partner-preview-locked">{children}</div>
          ) : children}
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
  // v2-only props — used by the studio-empty-overlay shape so the
  // empty layer can render its own draft picker + section-aware
  // silhouette bg. v1 path ignores all of these and keeps the old
  // .empty-layer-state structure.
  section,
  layer,
  draftPickerLabel,
  story,
  setStory,
  autosaveEnabled,
  addIcon,
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
  /** v2: which layer this empty state belongs to. Drives the
   *  data-section attribute the silhouette CSS bg targets. */
  section?: LayerKey;
  /** v2: layer key passed to the embedded LayerDraftPicker so the
   *  CTA inside the empty overlay can open the correct layer's
   *  drafts. Same value as `section` in current callers; kept as a
   *  separate prop for type safety with LayerDraftPicker's contract. */
  layer?: LayerKey;
  /** v2: human label for the draft picker — e.g. "Characters" so
   *  the trigger reads "Characters Draft 1". */
  draftPickerLabel?: string;
  /** v2: needed by the embedded LayerDraftPicker to read/write the
   *  active draft. Passed through from each tab. */
  story?: Story;
  setStory?: (u: (s: Story) => Story) => void;
  /** v2: whether autosave is on — controls the picker's "Save draft"
   *  button rendering inside the overlay. */
  autosaveEnabled?: boolean;
  /** v2: optional override for the primary (Add) button's glyph.
   *  Defaults to /icon-add-cta.svg. Script's empty state passes a
   *  back-arrow icon so the "Go to Story" CTA reads as navigation
   *  rather than creation. */
  addIcon?: React.ReactNode;
}) {
  const hasActions = !!onAdd || !!onGenerate;
  const isV2 = useIsV2();

  // ── v2 empty-state OVERLAY shape ────────────────────────────────
  // Replaces the white card / silhouette-img / negative-margin tricks
  // of v1. Single fixed-position container. Silhouette becomes a CSS
  // background-image keyed off data-section. Layer draft picker is
  // rendered inline (a second instance — the layer-bar's own picker
  // is hidden via :has() while the overlay is present, so the user
  // only ever sees one CTA at a time but cross-fade is trivial).
  if (isV2) {
    return (
      <div
        className="studio-empty-overlay"
        data-section={section}
        // Hook for Studio-level CSS to detect "any empty state present"
        // via :has(.studio-empty-overlay) and morph the tab-bar +
        // hide layer-bar / scroll content accordingly.
      >
        {layer && story && setStory && draftPickerLabel && (
          <div className="empty-overlay-draft">
            <LayerDraftPicker
              layer={layer}
              label={draftPickerLabel}
              story={story}
              setStory={setStory}
              autosaveEnabled={!!autosaveEnabled}
            />
          </div>
        )}
        <div className="empty-overlay-title ds-type-empty-header">{title}</div>
        <div className="empty-overlay-caption ds-type-body-sm">{caption}</div>
        {hasActions && (
          // Carries `.empty-layer-actions` too so the v2 button-pair
          // styling (glyph + label, no pill) keeps applying. The
          // `.empty-overlay-actions` class layers overlay-specific
          // positioning on top. `ds-type-cta` is on each Button so
          // the new type token (Lato Medium 9/auto/0.08em UPPER on
          // mobile, 11 on desktop) drives the label.
          <div className="empty-layer-actions empty-overlay-actions">
            {onAdd && (
              <Button
                variant="primary"
                size="sm"
                onClick={onAdd}
                disabled={!!generating}
                icon={addIcon ?? <img src="/icon-add-cta.svg" alt="" aria-hidden="true" />}
                className="ds-type-cta"
              >
                {addLabel}
              </Button>
            )}
            {onGenerate && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onGenerate}
                disabled={!!generating}
                icon={<img src="/icon-ai-cta.svg" alt="" aria-hidden="true" />}
                className="empty-state-ai-btn ds-type-cta"
              >
                {generating ? generatingLabel : generateLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── v1 path — unchanged ─────────────────────────────────────────
  return (
    <div className="empty-layer-state">
      <div className="empty-layer-icon">{icon}</div>
      <div className="empty-layer-title">{title}</div>
      <div className="empty-layer-caption ds-type-body-sm">{caption}</div>
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
        // V2: paired-bolt glyph (yellow inner + dark outline) shipped
        // as `/icon-ai-button.svg`. Carries its own colors so we
        // don't tint via CSS. v1 still inherits the inline lightning
        // glyph below via the v1 path of `.ai-wand`.
        <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
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
  noToggle,
  inline,
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
  /** Cross-episode lock — see AttrRow.noToggle. When set, the row
   *  shows the value as static read-only text and a tap fires the
   *  callback (used to surface a toast). Caret hidden, no input
   *  rendered. */
  noToggle?: () => void;
  /** Permanent inline layout — input sits in the values slot to the
   *  right of the label and never collapses below it. AI wand /
   *  pager / copy / dot still render alongside the label. Used for
   *  short single-line fields (Concept Title, Character Name,
   *  Character Age, Scene Name) where the expand/collapse pattern
   *  reads as fussy. */
  inline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hasValue = value.trim().length > 0;
  const isLockedDisplay = !!noToggle;
  const isOpen = (hasValue || focused) && !isLockedDisplay;

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

  // Inline branch — single permanent row, no expand/collapse. The
  // input sits in the .attr-values flex slot so its left edge lines
  // up with the placeholder text x-coordinate of every other AttrRow
  // in the same form. Carets are dropped because there's no body to
  // open into.
  if (inline) {
    return (
      <div className="attr-row attr-row-inline-input" data-label={label}>
        <div className="attr-row-header">
          <span className="attr-label ds-type-attribute-title">
            {label}
            {ai && !readOnly && !isLockedDisplay && <AIWandButton onClick={ai} loading={!!aiLoading} />}
            {copyBtn}
            {speak}
            {dot && <span className="sync-dot attr-dot" />}
          </span>
          <div className="attr-values">
            <input
              className="attr-inline-text-input"
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={(readOnly || isLockedDisplay) ? "None added" : placeholder}
              disabled={readOnly || isLockedDisplay}
              onClick={isLockedDisplay ? () => noToggle!() : undefined}
            />
          </div>
          {!readOnly && !isLockedDisplay && pager}
        </div>
      </div>
    );
  }

  if (!isOpen) {
    // Collapsed branch covers three cases:
    //  1. Normal: empty + not focused → tappable, opens to input.
    //  2. Partner-preview (readOnly): header non-interactive, shows
    //     "None added" placeholder, caret hidden.
    //  3. Cross-episode lock (noToggle): header tap fires noToggle to
    //     show a toast. Renders the value (if any) as a read-only
    //     pill so the user can see what's set; caret hidden.
    // Rendered as <div role="button"> rather than <button> so the
    // inner AIWandButton (and pager/copy buttons) aren't nested
    // inside another button — browsers split nested buttons
    // inconsistently, causing intermittent inner-control clicks.
    const interactive = isLockedDisplay || !readOnly;
    const headerClick = () => {
      if (!interactive) return;
      if (isLockedDisplay) { noToggle!(); return; }
      setFocused(true);
    };
    return (
      <div className="attr-row" data-label={label}>
        <div
          className="attr-row-header"
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-disabled={!interactive || undefined}
          onClick={headerClick}
          onKeyDown={interactive ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              headerClick();
            }
          } : undefined}
        >
          <span className="attr-label ds-type-attribute-title">
            {label}
            {/* AI wand + history pager hide in readOnly / locked
                modes — neither action makes sense when the viewer
                can't write to the draft. */}
            {ai && !readOnly && !isLockedDisplay && <AIWandButton onClick={ai} loading={!!aiLoading} />}
            {copyBtn}
            {speak}
            {dot && <span className="sync-dot attr-dot" />}
          </span>
          <div className="attr-values">
            {hasValue
              ? <span className="attr-pill">{value}</span>
              : <span className="attr-placeholder">{(readOnly || isLockedDisplay) ? "None added" : placeholder}</span>
            }
          </div>
          {!readOnly && !isLockedDisplay && pager}
          {!readOnly && !isLockedDisplay && (
            <svg className="attr-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          )}
        </div>
      </div>
    );
  }

  const inputClass = `attr-text-input ${!focused && hasValue ? "unfocused-filled" : ""}`;

  return (
    <div className="attr-row attr-row-text-open" data-label={label}>
      <div className="attr-row-header attr-row-header-static">
        <span className="attr-label ds-type-attribute-title">
          {label}
          {/* Same readOnly rule as the collapsed branch above. */}
          {ai && !readOnly && <AIWandButton onClick={ai} loading={!!aiLoading} />}
          {copyBtn}
          {dot && <span className="sync-dot attr-dot" />}
        </span>
        {!readOnly && pager}
      </div>
      <div className="attr-row-body">
        {(() => {
          const inputEl = multiline ? (
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
          );
          return readOnly ? <div className="partner-preview-locked">{inputEl}</div> : inputEl;
        })()}
      </div>
    </div>
  );
}

function ConceptTab({
  story,
  setStory,
  autosaveEnabled = true,
  onOpenUpdateTray,
  activeEpisodeId,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
  /** TV-only: the episode the user is currently viewing. Episode 1 is
   *  the master for Concept — every other episode shows Concept rows
   *  read-only, and only the new "Episode Title" row remains editable
   *  (it edits the active episode's title, not the show title). `null`
   *  / undefined falls back to treating the pilot as active. */
  activeEpisodeId?: string | null;
}) {
  const d = getActiveConceptDraft(story);
  const isV2 = useIsV2();
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
  // Episode-1-as-master gate. For TV projects, every Concept field below
  // is owned by the pilot — viewing any other episode renders the rows
  // as read-only. The new Episode Title row (added below) is the single
  // exception: it always edits the active episode's title. For non-TV
  // projects, `conceptLocked` is permanently false so feature/short
  // behavior is unchanged.
  const isTV = story.projectType === "tv-show";
  const activeStoryLayer = getActiveStoryLayerDraft(story);
  const episodes = activeStoryLayer.episodes ?? [];
  const pilotEpisode = episodes[0];
  const effectiveEpisodeId = activeEpisodeId ?? pilotEpisode?.id ?? null;
  const activeEpisode = episodes.find(ep => ep.id === effectiveEpisodeId) ?? null;
  const conceptLocked =
    isTV && !!pilotEpisode && effectiveEpisodeId !== pilotEpisode.id;
  // Toast that fires when the user taps a locked Concept row on a
  // non-pilot episode. Auto-clears after 2.6s. The lockTap handler
  // is passed to AttrRow/TextAttrRow as `noToggle`, which routes the
  // header click here instead of opening the row.
  const [lockToast, setLockToast] = useState<string | null>(null);
  const lockToastTimer = useRef<number | null>(null);
  const showLockToast = () => {
    setLockToast(`Concept is set on Episode 1 — open ${pilotEpisode ? `“${pilotEpisode.title || "the Pilot"}”` : "Episode 1"} to edit.`);
    if (lockToastTimer.current) window.clearTimeout(lockToastTimer.current);
    lockToastTimer.current = window.setTimeout(() => setLockToast(null), 2600);
  };
  useEffect(() => () => {
    if (lockToastTimer.current) window.clearTimeout(lockToastTimer.current);
  }, []);
  const lockTap: (() => void) | undefined = conceptLocked ? showLockToast : undefined;
  // ro() = partner-preview only; cross-episode lock now flows through
  // `noToggle={lockTap}` instead, which fully prevents row expansion
  // and surfaces the toast on tap.
  const ro = (extra?: boolean): boolean =>
    isPartnerPreviewing || !!extra;
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

      {!isPartnerPreviewing && !isV2 && (
        <Tip id="concept-drafts-are-free">
          Save as many Concept drafts as you want — experiment freely. Your active draft is what the rest of the app reads.
        </Tip>
      )}

      {/* Left-column wrapper. On mobile, `.v2-concept-col-left` is
          display:contents (transparent) so the rows behave exactly as
          before. On desktop, the wrapper becomes a single rounded
          card (#FCFBFB fill, 0.7px gray-outline stroke) containing
          Format / Duration / Short Structure / Episode Title / Genre
          / Sub-Genre stacked with thin divider lines between them. */}
      <div className="v2-concept-col-left">
      {/* Format */}
      <AttrRow
        label="Format"
        values={[formatLabel.toUpperCase()]}
        expanded={openAttr === "format"}
        onToggle={() => toggle("format")}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "projectType")}
        copyAction={previewCopy("projectType")}
        readOnly={ro()}
        noToggle={lockTap}
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

      {/* Short Structure — short-film only. Sits directly under Format
          because it's the primary structural lever for shorts: prompts
          use a flexible Situation → Pressure → Shift skeleton, and the
          picked value adds an ending-posture flavor (resolution / openness
          / hook / observation / reveal). Hidden for features and TV. The
          legacy "Story Framework" row further down is still rendered for
          shorts as a soft fallback (used only when shortStructure is
          unset). Tap-to-toggle clears, matching the Framework picker. */}
      {story.projectType === "short" && (
        <AttrRow
          label="Short Structure"
          values={d.settings.shortStructure
            ? [d.settings.shortStructure.replace(/-/g, " ").toUpperCase()]
            : undefined}
          placeholder="Pick a short-form structure"
          expanded={openAttr === "shortStructure"}
          onToggle={() => toggle("shortStructure")}
          readOnly={ro()}
          noToggle={lockTap}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {([
              {
                value: "complete" as const,
                label: "Complete Short",
                description: "A compact story with a clear beginning, middle, and end. Resolves.",
              },
              {
                value: "open-ended" as const,
                label: "Open-Ended Short",
                description: "A story moment that resolves emotionally but leaves the larger outcome unknown.",
              },
              {
                value: "proof-of-concept" as const,
                label: "Proof of Concept",
                description: "A short that introduces a world, tone, character, or premise for a bigger story.",
              },
              {
                value: "slice-of-life" as const,
                label: "Slice of Life",
                description: "A focused moment from a character's life — subtle, observational, often unresolved.",
              },
              {
                value: "twist" as const,
                label: "Twist Short",
                description: "A compact setup built around a reveal, reversal, or final punch.",
              },
            ]).map(s => (
              <button
                key={s.value}
                className={`choice ${d.settings.shortStructure === s.value ? "selected" : ""}`}
                onClick={() => {
                  // Tap-to-toggle: tapping the already-selected option
                  // clears it. Mirrors Framework's behavior.
                  const next = d.settings.shortStructure === s.value ? null : s.value;
                  updateDraft({ settings: { ...d.settings, shortStructure: next } });
                }}
                style={{ textAlign: "left", padding: "12px 17px" }}
              >
                <div className="choice-title">{s.label}</div>
                <div className="choice-sub">{s.description}</div>
              </button>
            ))}
          </div>
        </AttrRow>
      )}

      {/* Duration — short-film only. Drives the default scene count in
          short-form prompts via 7-bucket runtime → scene-count mapping
          (1–3 min → 2–4 scenes ... 20–30 min → 15–30 scenes). Hidden for
          features and TV — feature scene count is already handled by the
          legacy "14–22 scenes" range, and TV uses pilot-episode logic.
          Stored value survives a temporary format swap so the user can
          experiment without losing the runtime they picked. */}
      {story.projectType === "short" && (
        <AttrRow
          label="Duration"
          values={d.settings.duration ? [`${d.settings.duration} MIN`] : undefined}
          placeholder="10–15 min"
          expanded={openAttr === "duration"}
          onToggle={() => toggle("duration")}
          readOnly={ro()}
          noToggle={lockTap}
        >
          <Input
            type="number"
            min={1}
            max={60}
            placeholder="e.g. 12"
            value={d.settings.duration ?? ""}
            onChange={e => {
              const n = parseInt(e.target.value, 10);
              const next = Number.isFinite(n) && n > 0 ? Math.min(60, n) : undefined;
              updateDraft({ settings: { ...d.settings, duration: next } });
            }}
          />
        </AttrRow>
      )}

      {/* Title — sits directly below Format per spec so the two
          project-identity fields (format + title) cluster at the top
          of Concept, before the genre/tone/theme triage begins. */}
      <TextAttrRow
        label={isTV ? "Show Title" : "Title"}
        value={story.title}
        placeholder="Add a title"
        onChange={v => setStory(s => updateConceptDraft({ ...s, title: v }, {}))}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "title")}
        ai={() => generateConcept("title")}
        aiLoading={aiBusy === "title"}
        copyAction={previewCopy("title")}
        readOnly={ro()}
        noToggle={lockTap}
        inline
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

      {/* Episode Title — TV-only attribute row. Sits directly under
          Show Title and is the ONE field that remains editable when the
          user is viewing a non-pilot episode (every other Concept row
          locks via `ro()`). Writes to the active episode's `title` on
          the active StoryLayerDraft, so the value lives alongside the
          beats it belongs to. */}
      {isTV && activeEpisode && (
        <TextAttrRow
          label="Episode Title"
          value={activeEpisode.title}
          placeholder={`Episode ${activeEpisode.number}`}
          onChange={v => {
            const targetId = activeEpisode.id;
            setStory(s => {
              const slId = getActiveStoryLayerDraft(s).id;
              return {
                ...s,
                storyDrafts: s.storyDrafts.map(sd =>
                  sd.id === slId
                    ? {
                        ...sd,
                        episodes: (sd.episodes ?? []).map(ep =>
                          ep.id === targetId ? { ...ep, title: v } : ep
                        ),
                        updatedAt: new Date().toISOString(),
                      }
                    : sd
                ),
                updatedAt: new Date().toISOString(),
              };
            });
          }}
          readOnly={isPartnerPreviewing}
        />
      )}

      {/* Genre */}
      <AttrRow
        label="Genre"
        values={d.settings.genres.length > 0 ? d.settings.genres.map(g => g.toUpperCase()) : undefined}
        placeholder="Select genres"
        expanded={openAttr === "genre"}
        onToggle={() => toggle("genre")}
        dot={!autosaveEnabled && isConceptFieldDirty(story, "genres")}
        copyAction={previewCopy("genres")}
        readOnly={ro()}
        noToggle={lockTap}
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
            readOnly={ro()}
            noToggle={lockTap}
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
      </div>{/* /.v2-concept-col-left */}

      {/* Right-column wrapper. Same display:contents-on-mobile,
          card-on-desktop pattern as .v2-concept-col-left. Contains
          Logline / Summary / Similar To / Writer Style / Tone /
          Themes / Story Framework / Ending. The portal-rendered
          picker sheets after Ending stay OUTSIDE this wrapper. */}
      <div className="v2-concept-col-right">
      {/* Similar To — free-form references (films / shows) each tagged
          with which craft aspects the user wants to mirror. */}
      <AttrRow
        label="Similar To"
        values={d.settings.references.length > 0 ? d.settings.references.map(r => r.title.toUpperCase()) : undefined}
        placeholder="Add films or shows"
        expanded={openAttr === "references"}
        onToggle={() => toggle("references")}
        copyAction={previewCopy("references")}
        readOnly={ro()}
        noToggle={lockTap}
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

      {/* Writer Style — roster of famous screenwriters. Same collapsing
          AttrRow treatment as Similar To: selected writers show as pills
          on the header, expanding the row reveals a Select/Edit button
          that opens the same fly-up sheet of writers. */}
      <AttrRow
        label="Writer Style"
        values={d.settings.writerStyles.length > 0 ? d.settings.writerStyles.map(w => w.toUpperCase()) : undefined}
        placeholder="Pick writers you want to echo"
        expanded={openAttr === "writerStyles"}
        onToggle={() => toggle("writerStyles")}
        copyAction={previewCopy("writerStyles")}
        readOnly={ro()}
        noToggle={lockTap}
      >
        <Button
          variant="secondary"
          size="lg"
          block
          onClick={() => { setWriterFilter(""); setWriterSheetOpen(true); }}
        >
          {d.settings.writerStyles.length > 0 ? "Edit writers" : "Select writers"}
        </Button>
      </AttrRow>

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
        readOnly={ro()}
        noToggle={lockTap}
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
        readOnly={ro()}
        noToggle={lockTap}
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
        readOnly={ro()}
        noToggle={lockTap}
        note={d.settings.toneNote}
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
        <Textarea
          value={d.settings.toneNote ?? ""}
          onChange={e => updateDraft({ settings: { ...d.settings, toneNote: e.target.value } })}
          placeholder="Add direction (optional) — elaborate on the tone you want, in your own words"
          rows={3}
          style={{ marginTop: 12, marginBottom: 0 }}
          readOnly={ro()}
        />
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
        readOnly={ro()}
        noToggle={lockTap}
        note={d.settings.themesNote}
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
        <Textarea
          value={d.settings.themesNote ?? ""}
          onChange={e => updateDraft({ settings: { ...d.settings, themesNote: e.target.value } })}
          placeholder="Add direction (optional) — elaborate on the themes you want, in your own words"
          rows={3}
          style={{ marginTop: 12, marginBottom: 0 }}
          readOnly={ro()}
        />
      </AttrRow>

      {/* Story Framework — beat-skeleton framework the AI uses when generating
          beats and syncing Story from other layers. Optional: if unset,
          prompts tell the model to pick whatever fits the concept. For
          shorts, this is the soft fallback — Short Structure (rendered up
          near Format) is the primary lever. Rendered with the same .choice
          button treatment as Format, but each option includes a 1–2
          sentence description under the title so newcomers can recognize
          what they're picking. */}
      <AttrRow
        label="Story Framework"
        values={d.settings.framework
          ? [d.settings.framework.replace(/-/g, " ").toUpperCase()]
          : undefined}
        placeholder="Pick a structure"
        expanded={openAttr === "structure"}
        onToggle={() => toggle("structure")}
        readOnly={ro()}
        noToggle={lockTap}
        note={d.settings.frameworkNote}
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
        <Textarea
          value={d.settings.frameworkNote ?? ""}
          onChange={e => updateDraft({ settings: { ...d.settings, frameworkNote: e.target.value } })}
          placeholder="Add direction (optional) — elaborate on the structure you want, in your own words"
          rows={3}
          style={{ marginTop: 12, marginBottom: 0 }}
          readOnly={ro()}
        />
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
        readOnly={ro()}
        noToggle={lockTap}
        note={d.settings.endingNote}
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
        <Textarea
          value={d.settings.endingNote ?? ""}
          onChange={e => updateDraft({ settings: { ...d.settings, endingNote: e.target.value } })}
          placeholder="Add direction (optional) — elaborate on the ending you want, in your own words"
          rows={3}
          style={{ marginTop: 12, marginBottom: 0 }}
          readOnly={ro()}
        />
      </AttrRow>
      </div>{/* /.v2-concept-col-right */}

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
      {/* Cross-episode lock toast — fires when the user taps a Concept
          row on a non-pilot episode. Auto-clears via setTimeout in
          showLockToast. Reuses the global `.toast` class. */}
      <div className={`toast ${lockToast ? "show" : ""}`}>{lockToast}</div>
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
  activeEpisodeId,
  charsInFlight,
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
  /** TV-only: the episode the user is currently viewing. Used to lock
   *  edit/delete on characters whose createdInEpisodeId differs — the
   *  card stays visible but read-only until the user switches to the
   *  episode that owns it. `null` means "no episode picked yet"; in
   *  that case we fall back to treating the pilot as active. */
  activeEpisodeId?: string | null;
  /** Set of character ids whose AI portrait request is currently
   *  in-flight (auto-fill effect or close-sheet path). Drives the
   *  shimmer placeholder on each character card's portrait box. */
  charsInFlight: Set<string>;
}) {
  const d = getActiveCharactersDraft(story);
  const { profile } = useProfileCapture();
  const isV2 = useIsV2();
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
  const isDesktop = useIsDesktopStudio();
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

  // ── Single-character AI add ─────────────────────────────────
  // Wired to the desktop populated-state "Add a Character" white
  // chip. Calls the new `generate_character` action (parallel to
  // `generate_beat`) which returns ONE complete character JSON
  // shaped for direct append. The new row lands at the end of
  // the active draft per spec. Image generation is NOT triggered
  // here — the existing auto-fill effect at Studio scope picks
  // up new characters with a name and queues their portrait on
  // next render.
  const [addOneBusy, setAddOneBusy] = useState(false);
  async function addOneCharacter() {
    if (addOneBusy) return;
    setAddOneBusy(true);
    try {
      const action: ActionRequest = {
        type: "generate_character",
        payload: {},
      };
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, action, profile }),
      });
      if (!res.ok || !res.body) {
        throw new Error("Failed to generate character");
      }
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
          try {
            const msg = JSON.parse(line);
            if (msg.type === "text") full += msg.value;
          } catch {}
        }
      }
      const match = full.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Empty model response");
      const parsed = JSON.parse(match[0]);
      const allowedRoles = new Set([
        "protagonist", "antagonist", "supporting",
        "mentor", "love_interest", "comic_relief",
      ]);
      const role = allowedRoles.has(parsed.role) ? parsed.role : "supporting";
      // Inline TV-episode lookup to avoid depending on isTV /
      // activeStoryLayer constants that are declared further down
      // in the component body (TDZ for `const`s used before their
      // declaration line).
      const isTVProject = story.projectType === "tv-show";
      const storyLayer = getActiveStoryLayerDraft(story);
      const creatorEpisodeId = isTVProject
        ? (activeEpisodeId ?? storyLayer.episodes?.[0]?.id ?? null)
        : null;
      const newChar: Character = {
        id: "ch_" + Math.random().toString(36).slice(2),
        name: String(parsed.name ?? "").trim(),
        role,
        archetype: String(parsed.archetype ?? "").trim(),
        backstory: String(parsed.backstory ?? "").trim(),
        motivations: String(parsed.motivations ?? "").trim(),
        flaws: String(parsed.flaws ?? "").trim(),
        want: String(parsed.want ?? "").trim(),
        need: String(parsed.need ?? "").trim(),
        relationships: [],
        voice: String(parsed.voice ?? "").trim(),
        arc: String(parsed.arc ?? "").trim(),
        notes: String(parsed.notes ?? "").trim(),
        ...(creatorEpisodeId ? { createdInEpisodeId: creatorEpisodeId } : {}),
      };
      setStory(s => updateCharactersDraft(s, {
        characters: [...getActiveCharactersDraft(s).characters, newChar],
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") window.alert(msg);
    } finally {
      setAddOneBusy(false);
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
  // Cross-episode lock: any character whose creator-episode differs from
  // the active one shows a lock badge on its card. The card still opens
  // the sheet — the sheet itself renders read-only with a banner pointing
  // at the right episode. Non-TV projects always treat as unlocked.
  const isTV = story.projectType === "tv-show";
  const activeStoryLayer = getActiveStoryLayerDraft(story);
  const effectiveEpisodeId =
    activeEpisodeId ?? activeStoryLayer.episodes?.[0]?.id ?? null;
  const lockedFromEpisode = (ch: Character): { number: number } | null => {
    if (!isTV || !ch.createdInEpisodeId || !effectiveEpisodeId) return null;
    if (ch.createdInEpisodeId === effectiveEpisodeId) return null;
    const owner = activeStoryLayer.episodes?.find(ep => ep.id === ch.createdInEpisodeId);
    return owner ? { number: owner.number } : null;
  };

  // V2 inline action row for the populated state — Add Character +
  // Auto Create. Renders into the LayerBar's rightSlot below so the
  // Single AI-styled "Add All Characters" chip on the layer draft
  // dropdown bar's right slot. Shares the .ai-wand chip's fill /
  // inset stroke / drop shadow so it reads as a sibling of the
  // per-row AI buttons in Concept; uses the same paired-bolt glyph
  // (icon-ai-button.svg). 30px-from-screen-edge inset comes from
  // the layer-bar's own padding-right: 30 — no extra margin
  // needed on the chip itself. Hidden during partner-previewing.
  // Desktop populated state — pair of buttons in the layer-bar's
  // right slot. Black (primary) opens the manual character sheet;
  // white (secondary) fires the AI single-add. Mobile keeps the
  // legacy single "Add All Characters" chip so the bar doesn't
  // crowd at small widths.
  const v2CastActions = isV2 && hasCharacters && !previewActive ? (
    isDesktop ? (
      <div className="v2-add-one-actions">
        <button
          type="button"
          className="add-one-chip-primary"
          onClick={openNewCharacter}
          disabled={addOneBusy || genBusy}
        >
          <img src="/icon-add-cta.svg" alt="" aria-hidden="true" />
          <span>Add a Character</span>
        </button>
        <button
          type="button"
          className="add-one-chip"
          onClick={addOneCharacter}
          disabled={addOneBusy || genBusy}
        >
          <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
          <span>{addOneBusy ? "Creating…" : "Add a Character"}</span>
        </button>
      </div>
    ) : (
      <button
        type="button"
        className="add-all-characters-chip"
        onClick={generateAllCharacters}
        disabled={genBusy}
      >
        <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
        <span>{genBusy ? "Creating…" : "Add All Characters"}</span>
      </button>
    )
  ) : null;

  return (
    <>
      <LayerBar
        layer="characters"
        label="Characters"
        story={story}
        setStory={setStory}
        autosaveEnabled={autosaveEnabled}
        onOpenUpdateTray={onOpenUpdateTray}
        rightSlot={v2CastActions}
      />

      {/* Top-of-content Tip — only surfaces after the user has added
          their first character. On an empty tab the EmptyLayerState
          below is already teaching the main move; a second teaching
          surface on top would clutter the first-paint view. */}
      {hasCharacters && !isV2 && (
        <Tip id="characters-distinct-voices" persist={false}>
          Give each character a distinct voice and clear want — it&apos;s what makes dialogue feel alive on the page.
        </Tip>
      )}

      {!hasCharacters && (
        <EmptyLayerState
          section="characters"
          layer="characters"
          draftPickerLabel="Characters"
          story={story}
          setStory={setStory}
          autosaveEnabled={autosaveEnabled}
          icon={
            isV2
              ? <img src="/v2/empty-state-characters.png" alt="" className="empty-layer-icon-v2" />
              : <img src="/character-icon.svg" width={41} height={44} alt="" />
          }
          title={isV2 ? "Define Your Characters" : "No characters yet"}
          caption={
            isV2
              ? "Create the characters who carry the plot. Define their roles and motivations as your world takes shape."
              : "Create your first character to bring your story to life."
          }
          addLabel={isV2 ? "Add a Character" : "Add character"}
          onAdd={openNewCharacter}
          onGenerate={generateAllCharacters}
          generating={genBusy}
          generateLabel={isV2 ? "Create With AI" : "Create all with AI"}
          generatingLabel="Creating…"
        />
      )}

      {/* Character rows — tapping opens the unified character sheet. */}
      {d.characters.map(ch => {
        const lock = lockedFromEpisode(ch);
        const roleLabel = roleLabels[ch.role] || ch.role || "";
        // Description for the v2 card: prefer backstory; fall back to
        // motivations / want so newly-AI-seeded characters still surface
        // a short blurb on the card.
        const v2Description =
          (ch.backstory && ch.backstory.trim())
          || (ch.motivations && ch.motivations.trim())
          || (ch.want && ch.want.trim())
          || "";
        return (
        <div key={ch.id} className={`card character-card${isV2 ? " v2-character-card" : ""}`}>
          <button
            className="character-header"
            onClick={() => openCharacter(ch.id)}
          >
            {isV2 ? (
              charsInFlight.has(ch.id) ? (
                <div className="v2-character-portrait ds-image-shimmer is-dark" aria-label="Generating character portrait" />
              ) : ch.thumbnail ? (
                <img src={ch.thumbnail} alt="" className="v2-character-portrait" />
              ) : (
                <div className="v2-character-portrait v2-character-portrait-placeholder">
                  {ch.name ? ch.name[0].toUpperCase() : "?"}
                </div>
              )
            ) : (
              <div className="character-avatar">
                {ch.name ? ch.name[0].toUpperCase() : "?"}
              </div>
            )}
            <div className="v2-character-body" style={isV2 ? undefined : { flex: 1, textAlign: "left" }}>
              {isV2 ? (
                <>
                  <div className="v2-character-name ds-type-project-card-title">
                    {ch.name || "Unnamed character"}
                  </div>
                  {roleLabel && (
                    <div className={`v2-character-role-pill v2-character-role-${ch.role || "default"}`}>
                      {roleLabel}
                    </div>
                  )}
                  {v2Description && (
                    <div className="v2-character-description ds-type-body">
                      {v2Description}
                    </div>
                  )}
                  {/* Attribute pills (age / gender / archetype) shown
                      at the bottom of the desktop card per the spec.
                      Mobile hides this row via CSS so the existing
                      122px-tall card layout is unchanged. */}
                  {(ch.age?.trim() || ch.gender?.trim() || ch.archetype?.trim()) && (
                    <div className="v2-character-attrs">
                      {ch.age?.trim() && (
                        <span className="v2-character-attr-pill">{ch.age}</span>
                      )}
                      {ch.gender?.trim() && (
                        <span className="v2-character-attr-pill">{ch.gender}</span>
                      )}
                      {ch.archetype?.trim() && (
                        <span className="v2-character-attr-pill">{ch.archetype}</span>
                      )}
                    </div>
                  )}
                  {lock && (
                    <span
                      className="v2-character-lock"
                      aria-label={`Created in Episode ${lock.number} — locked`}
                      title={`Created in Episode ${lock.number} — switch to that episode to edit`}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                      EP {lock.number}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, fontWeight: 900, display: "flex", alignItems: "center", gap: 6 }}>
                    {ch.name || "Unnamed character"}
                    {lock && (
                      <span
                        aria-label={`Created in Episode ${lock.number} — locked`}
                        title={`Created in Episode ${lock.number} — switch to that episode to edit`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: "var(--surface-2, #f3f3f4)",
                          color: "var(--ink-mute)",
                          letterSpacing: 0.3,
                        }}
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="4" y="11" width="16" height="10" rx="2" />
                          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                        </svg>
                        EP {lock.number}
                      </span>
                    )}
                  </div>
                  <div className="caption">
                    {roleLabel || "No role"}
                    {ch.archetype && ` · ${ch.archetype}`}
                  </div>
                </>
              )}
            </div>
            {isV2 ? (
              <span className="v2-character-menu" aria-hidden="true">
                <img src="/icon-options.svg" alt="" />
              </span>
            ) : (
              <span className="beat-expand">›</span>
            )}
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
      );})}

      {/* Bottom sticky "Add character" bar is mobile-only. Desktop
          already exposes BOTH a manual add chip and an AI add chip
          inline with the LayerBar (top of the tab), so the persistent
          bottom bar would be redundant — and on a wide viewport its
          full-width pill looked oddly stranded against the content. */}
      {hasCharacters && !isDesktop && (
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
  autoGenInFlight = false,
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
  /** True when Studio's bulk auto-gen effect is currently fetching
   *  an AI portrait for this character. Drives the shimmer state on
   *  the form's portrait box so the user sees the same "generating
   *  now" signal here as on the character list. Composed with the
   *  form's local `imgBusy` (which tracks manual Generate clicks). */
  autoGenInFlight?: boolean;
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
  const [openAttr, setOpenAttr] = useState<string | null>(null);
  const toggleAttr = (k: string) => setOpenAttr(o => o === k ? null : k);
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

  // Display-friendly version of role/gender for the collapsed AttrRow header.
  const genderLabel = (() => {
    const map: Record<string, string> = {
      male: "MALE", female: "FEMALE", nonbinary: "NON-BINARY", unspecified: "UNSPECIFIED",
    };
    if (!ch.gender) return undefined;
    return map[ch.gender] ?? ch.gender.toUpperCase();
  })();
  const roleLabel = roles.find(r => r.key === ch.role)?.label.toUpperCase();
  const voiceLabel = (() => {
    if (!ch.aiVoice) return "AUTO";
    return ch.aiVoice.toUpperCase();
  })();

  // ── Character image: AI generation + upload ────────────────────
  // /api/generate-character-image takes a free-text character
  // description + the project's primary genre + tone and returns a
  // 5:6 painted-portrait JPEG data URL. Stored on Character.thumbnail.
  // The whole portrait block (preview + Generate + Upload) is shown
  // for v2 users only, and only on the edit sheet — the creation
  // sheet (`isNew`) keeps the form short until the character has at
  // least a name + role to inform a generation.
  const isV2Form = useIsV2();
  const [imgBusy, setImgBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  async function generateImage() {
    if (imgBusy) return;
    const description = [
      ch.name && `Name: ${ch.name}`,
      ch.role && `Role: ${roleLabel || ch.role}`,
      ch.gender && `Gender: ${ch.gender}`,
      ch.archetype && `Archetype: ${ch.archetype}`,
      ch.backstory && `Backstory: ${ch.backstory}`,
      ch.motivations && `Motivations: ${ch.motivations}`,
      ch.flaws && `Flaws: ${ch.flaws}`,
    ].filter(Boolean).join("\n");
    if (!description.trim()) {
      if (typeof window !== "undefined") {
        window.alert("Add a name + a few details (role, backstory, etc.) before generating a portrait.");
      }
      return;
    }
    const concept = getActiveConceptDraft(story);
    const primaryGenre = concept.settings?.genres?.[0];
    const projectTone = concept.concept?.tone;
    setImgBusy(true);
    try {
      const res = await fetch("/api/generate-character-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, genre: primaryGenre, tone: projectTone }),
      });
      const data = await res.json();
      if (data.thumbnail) {
        // Stamp imageGenAttempted alongside the new thumbnail so
        // auto-gen never re-fires for this character on a later
        // session (even if the thumbnail ever rolls back / goes
        // missing). Manual Generate clicks here are the explicit
        // re-gen path going forward.
        onUpdate({ thumbnail: data.thumbnail, imageGenAttempted: true });
      } else if (data.error && typeof window !== "undefined") {
        window.alert(data.error);
      }
    } catch (err: any) {
      if (typeof window !== "undefined") window.alert(err?.message || String(err));
    } finally {
      setImgBusy(false);
    }
  }

  // Upload a local image. Read as data URL → store on
  // Character.thumbnail, the same shape AI generation produces, so
  // the rest of the app doesn't need to know which path it came
  // from. No server-side resize for uploads; we trust the user's
  // source enough to inline it as-is.
  function onUploadClick() {
    fileInputRef.current?.click();
  }
  function onUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // imageGenAttempted set here too — even an upload counts as
      // "we've intentionally produced a thumbnail for this
      // character," so auto-gen shouldn't ever step on it later.
      if (typeof result === "string") onUpdate({ thumbnail: result, imageGenAttempted: true });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      {isV2Form && !isNew && (
        <div className="v2-character-form-portrait">
          {/* In-flight FIRST — covers both the local manual Regenerate
              click (imgBusy) and bulk auto-gen (autoGenInFlight). */}
          {(imgBusy || autoGenInFlight) ? (
            <div
              className="v2-character-form-portrait-img ds-image-shimmer is-dark"
              aria-label="Generating character portrait"
            />
          ) : ch.thumbnail ? (
            <img src={ch.thumbnail} alt="" className="v2-character-form-portrait-img" />
          ) : (
            <div className="v2-character-form-portrait-img v2-character-form-portrait-placeholder">
              {ch.name ? ch.name[0].toUpperCase() : "?"}
            </div>
          )}
          <div className="v2-character-form-portrait-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={generateImage}
              disabled={imgBusy}
              icon={<img src="/icon-ai-button.svg" alt="" aria-hidden="true" />}
            >
              {imgBusy ? "Generating…" : ch.thumbnail ? "Regenerate" : "Generate"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onUploadClick}
              disabled={imgBusy}
            >
              Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onUploadChange}
              style={{ display: "none" }}
            />
          </div>
        </div>
      )}
      <TextAttrRow
        label="Name"
        value={ch.name}
        placeholder="Add a name"
        onChange={v => onUpdate({ name: v })}
        ai={() => generateCharacterField("name")}
        aiLoading={aiBusy === "name"}
        pager={pagerFor("name")}
        inline
      />

      {/* Gender — chip selector. Four canonical buckets plus custom
          free-text (for genderfluid, agender, non-human characters,
          etc.). Optional: if the user leaves this blank, the sheet-
          close handler in Studio kicks off a name-based AI detection
          and fills it in. */}
      <AttrRow
        label="Gender"
        values={genderLabel ? [genderLabel] : undefined}
        placeholder="Pick a gender"
        expanded={openAttr === "gender"}
        onToggle={() => toggleAttr("gender")}
      >
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
              canonical four, render here as a selected chip showing the
              actual value; tapping clears the field. */}
          {ch.gender && !["male","female","nonbinary","unspecified"].includes(ch.gender) && (
            <Selector
              selected
              onClick={() => onUpdate({ gender: "" })}
            >
              {ch.gender} &#10005;
            </Selector>
          )}
        </div>
      </AttrRow>

      {/* Age — free-text. Sits between Gender and Role per the
          creation flow's natural ordering. Accepts numerics ("26")
          and language ("around 30", "ancient"). */}
      <TextAttrRow
        label="Age"
        value={ch.age ?? ""}
        placeholder="Add an age"
        onChange={v => onUpdate({ age: v })}
        inline
      />

      {/* Role — chip selector matching Concept tab (Genre, etc). */}
      <AttrRow
        label="Role"
        values={roleLabel ? [roleLabel] : undefined}
        placeholder="Pick a role"
        expanded={openAttr === "role"}
        onToggle={() => toggleAttr("role")}
      >
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
      </AttrRow>

      {/* Archetype — same AttrRow treatment as Role/Gender so the
          collapsed state shows the current pick as a pill and the
          AI wand sits beside the label. Custom-archetype input
          stays in the expanded body alongside the preset chips. */}
      <AttrRow
        label="Archetype"
        values={ch.archetype ? [ch.archetype.toUpperCase()] : undefined}
        placeholder="Pick an archetype"
        expanded={openAttr === "archetype"}
        onToggle={() => toggleAttr("archetype")}
        ai={() => generateCharacterField("archetype")}
        aiLoading={aiBusy === "archetype"}
      >
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
      </AttrRow>

      <TextAttrRow
        label="Backstory"
        value={ch.backstory}
        placeholder="Where they come from, what shaped them"
        onChange={v => onUpdate({ backstory: v })}
        multiline
        ai={() => generateCharacterField("backstory")}
        aiLoading={aiBusy === "backstory"}
        pager={pagerFor("backstory")}
      />

      <TextAttrRow
        label="Motivations"
        value={ch.motivations}
        placeholder="What drives them"
        onChange={v => onUpdate({ motivations: v })}
        multiline
        ai={() => generateCharacterField("motivations")}
        aiLoading={aiBusy === "motivations"}
        pager={pagerFor("motivations")}
      />

      <TextAttrRow
        label="Flaws"
        value={ch.flaws}
        placeholder="The cracks that complicate them"
        onChange={v => onUpdate({ flaws: v })}
        multiline
        ai={() => generateCharacterField("flaws")}
        aiLoading={aiBusy === "flaws"}
        pager={pagerFor("flaws")}
      />

      <TextAttrRow
        label="What they want (external)"
        value={ch.want}
        placeholder="The visible goal"
        onChange={v => onUpdate({ want: v })}
        ai={() => generateCharacterField("want")}
        aiLoading={aiBusy === "want"}
        pager={pagerFor("want")}
      />

      <TextAttrRow
        label="What they need (internal)"
        value={ch.need}
        placeholder="What they actually have to learn"
        onChange={v => onUpdate({ need: v })}
        ai={() => generateCharacterField("need")}
        aiLoading={aiBusy === "need"}
        pager={pagerFor("need")}
      />

      {/* Read-aloud voice — explicit OpenAI gpt-4o-mini-tts voice ID
          used when the script is read aloud. "Auto" leaves it unset
          and the playback layer falls back to a deterministic name-
          hash + gender-keyword heuristic, so unpicked characters
          still get a stable voice across sessions.

          The free-text "Voice direction" field below is separate but
          related: it's the delivery instructions ("hushed, menacing")
          that go to TTS as the `instructions` payload on top of the
          project-level dialogue style. The preview play button on
          each chip uses the SAME instructions as the real read-aloud
          flow, so what users hear during selection matches what
          they'll hear in Read Mode. */}
      <AttrRow
        label="Read-aloud voice"
        values={[voiceLabel]}
        placeholder="Pick a voice"
        expanded={openAttr === "voice"}
        onToggle={() => toggleAttr("voice")}
      >
        <div className="char-voice-grid">
          {([
            { id: null,      label: "Auto",     desc: "Pick automatically based on the character." },
            { id: "alloy",   label: "Alloy",    desc: "Neutral, even-toned." },
            { id: "echo",    label: "Echo",     desc: "Warm, masculine." },
            { id: "fable",   label: "Fable",    desc: "British, narrator-leaning, masculine." },
            { id: "onyx",    label: "Onyx",     desc: "Deep, gravelly, masculine." },
            { id: "nova",    label: "Nova",     desc: "Bright, expressive, feminine." },
            { id: "shimmer", label: "Shimmer",  desc: "Calm, soft, feminine." },
          ] as const).map(v => {
            // Selected when the explicit aiVoice matches, OR when both
            // are nullish and this is the Auto card.
            const selected = v.id === null
              ? !ch.aiVoice
              : ch.aiVoice === v.id;
            return (
              <div
                key={v.label}
                className={`char-voice-card${selected ? " selected" : ""}`}
                title={v.desc}
              >
                <button
                  type="button"
                  className="char-voice-pick"
                  onClick={() => onUpdate({ aiVoice: v.id })}
                  aria-pressed={selected}
                  aria-label={`${v.label} — ${v.desc}`}
                >
                  <span className="char-voice-name">{v.label}</span>
                </button>
                {/* Auto has no preview — it doesn't resolve to a single
                    voice until a name is in play. */}
                {v.id && (
                  <SpeakButton
                    size="sm"
                    text={`I have to do this. There is no other way.`}
                    voice={v.id}
                    instructions={ch.voice && ch.voice.trim()
                      ? `Deliver this line with the following voice direction: ${ch.voice.trim()}`
                      : undefined}
                    title={`Preview ${v.label}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </AttrRow>

      <TextAttrRow
        label="Voice direction (read aloud as…)"
        value={ch.voice}
        placeholder='e.g. "hushed, menacing, mid-30s"'
        onChange={v => onUpdate({ voice: v })}
        multiline
        ai={() => generateCharacterField("voice")}
        aiLoading={aiBusy === "voice"}
        pager={pagerFor("voice")}
      />

      <TextAttrRow
        label="Character arc"
        value={ch.arc}
        placeholder="How they change over the story"
        onChange={v => onUpdate({ arc: v })}
        multiline
        ai={() => generateCharacterField("arc")}
        aiLoading={aiBusy === "arc"}
        pager={pagerFor("arc")}
      />

      <TextAttrRow
        label="Additional notes"
        value={ch.notes}
        placeholder="Anything else worth tracking"
        onChange={v => onUpdate({ notes: v })}
        multiline
        ai={() => generateCharacterField("notes")}
        aiLoading={aiBusy === "notes"}
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
  beats, moments, moveBeat,
  openExistingScene, openScenePopup, openNewScene,
  run, busy, syncState,
  autosaveEnabled = true,
  onOpenUpdateTray,
  runGenerateAll,
  scenesInFlight,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  beats: Beat[];
  moments: Moment[];
  moveBeat: (index: number, direction: "up" | "down") => void;
  /** Open the unified scene sheet for editing an existing beat. */
  openExistingScene: (beatId: string) => void;
  /** v2 only — open the lightweight preview popup. v1 callers can
   *  ignore (the row click falls through to openExistingScene). */
  openScenePopup?: (beatId: string) => void;
  /** Insert a fresh blank beat at the given position and open its
   *  sheet — auto-discarded on close if the user filled nothing in. */
  openNewScene: (insertAt?: number) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
  syncState: LayerSyncState;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
  /** Wrap a Create-all action with the Studio-level scrim + sheet-close
   *  choreography. See `runGenerateAll` in Studio. */
  runGenerateAll: (fn: () => Promise<void>) => Promise<void>;
  /** Set of beat ids whose AI thumbnail request is currently in-flight.
   *  Drives the shimmer placeholder on each scene row's thumb. */
  scenesInFlight: Set<string>;
}) {
  const isV2 = useIsV2();
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartY = useRef(0);
  const touchOffsetY = useRef(0);
  const isDragActive = useRef(false);
  // Stays true for the tick after a drag-completed touchend so the
  // synthetic click that fires on touch release is suppressed —
  // otherwise the click would fall through to openScenePopup /
  // openExistingScene immediately after the user finishes a drag.
  const dragJustEnded = useRef(false);
  const beatRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cloneRef = useRef<HTMLDivElement | null>(null);

  const isDesktop = useIsDesktopStudio();
  // "Create everything for me" — one-tap beat generation. Derives from
  // Characters if the cast is populated (richer source), otherwise falls
  // back to Concept so the button still works on a brand-new project.
  const { profile } = useProfileCapture();
  const [genBusy, setGenBusy] = useState(false);
  // State for the desktop AI single-scene popup. When `insertAfterIdx`
  // is non-null, the popup is open; the user picks "Insert at start"
  // (-1) or "After scene N" (0..beats.length-1), then we call
  // `generate_beat` with the resolved position.
  const [aiSceneInsertOpen, setAiSceneInsertOpen] = useState(false);
  const [aiScenePickedIdx, setAiScenePickedIdx] = useState<number | null>(null);
  const [aiSceneBusy, setAiSceneBusy] = useState(false);
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

  // ── Single-scene AI add ──────────────────────────────────────
  // Wired to the desktop populated-state "Add a Scene" white chip.
  // The user picks where to insert in the popup (`aiScenePickedIdx`
  // = -1 → at start, N → after beat at index N), then we call
  // `generate_beat` for a fresh beat that fits the project bible
  // and insert it at the chosen position. The new beat lands in
  // status: "design" so the user can edit it via the existing
  // scene-edit flow; the existing auto-fill effect at Studio
  // scope queues the thumbnail.
  async function addOneScene(insertAfterIdx: number) {
    if (aiSceneBusy) return;
    setAiSceneBusy(true);
    try {
      const action: ActionRequest = {
        type: "generate_beat",
        payload: {
          // Pass a human-readable position hint to the prompt so
          // the model places the beat with the right narrative
          // shape. The actual array insertion happens client-side
          // below.
          position: insertAfterIdx < 0
            ? "the opening beat"
            : `after beat ${insertAfterIdx + 1} ("${beats[insertAfterIdx]?.name || "Untitled"}")`,
          weirdness: 5,
          darkness: 5,
          humor: 3,
          length: 5,
        },
      };
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, action, profile }),
      });
      if (!res.ok || !res.body) throw new Error("Failed to generate scene");
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
          try {
            const msg = JSON.parse(line);
            if (msg.type === "text") full += msg.value;
          } catch {}
        }
      }
      const match = full.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Empty model response");
      const parsed = JSON.parse(match[0]);
      const newBeat: Beat = {
        id: "b_" + Math.random().toString(36).slice(2),
        name: String(parsed.name ?? "").trim() || "New Scene",
        summary: String(parsed.summary ?? "").trim(),
        purpose: "",
        position: 0,
        momentIds: [],
        characterIds: [],
        status: "design",
      };
      const insertAt = insertAfterIdx + 1;
      setStory(s => {
        const sl = getActiveStoryLayerDraft(s);
        const existing = sl.beats;
        const updated = [
          ...existing.slice(0, insertAt),
          newBeat,
          ...existing.slice(insertAt),
        ].map((b, i) => ({ ...b, position: i }));
        return updateStoryLayerDraft(s, { beats: updated });
      });
      setAiSceneInsertOpen(false);
      setAiScenePickedIdx(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") window.alert(msg);
    } finally {
      setAiSceneBusy(false);
    }
  }

  const hasBeats = beats.length > 0;
  const activeStoryDraft = getActiveStoryLayerDraft(story);
  const direction = activeStoryDraft.direction ?? "";
  // Resolve Beat.characterIds → Character.name once per render. The
  // v2 desktop card's right-side meta column iterates each beat's
  // character ids and looks them up here. Falls back to "Unknown"
  // for IDs that no longer match a character (e.g. character deleted
  // after the beat was authored).
  const charNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of getActiveCharactersDraft(story).characters) {
      m.set(c.id, c.name);
    }
    return m;
  }, [story]);
  // Estimate scene duration from `sceneContent` word count. Returns
  // Returns the duration label number for the Story-tab card's
  // meta column. Resolution order:
  //   1. `beat.lengthMinutes` if explicitly set by the user
  //      (Scene length input in the edit sheet) — takes precedence.
  //   2. Estimate from `sceneContent` word count at ~200 words/min.
  //   3. null when neither source produces a value — the meta column
  //      hides the duration chip rather than showing "0 min" / "—".
  function estimateBeatMinutes(beat: Beat): number | null {
    if (typeof beat.lengthMinutes === "number" && beat.lengthMinutes > 0) {
      // Round to nearest whole minute for display — the stored
      // value may be fractional (e.g. 0.5) but the chip shows
      // integers. Math.max(1, …) ensures "0 min" never renders
      // for tiny but-non-zero values.
      return Math.max(1, Math.round(beat.lengthMinutes));
    }
    const text = (beat.sceneContent ?? "").trim();
    if (!text) return null;
    const words = text.split(/\s+/).filter(w => w.length > 0).length;
    if (words === 0) return null;
    return Math.max(1, Math.round(words / 200));
  }
  const [directionSheetOpen, setDirectionSheetOpen] = useState(false);

  // Add-All-Scenes chip on the populated layer-bar's right slot.
  // Mirrors the Characters tab's chip — same fill / inset stroke /
  // drop shadow / paired-bolt glyph as the per-row .ai-wand.
  // Reuses generateAllBeats so the bulk-create behavior stays one
  // code path. Hidden on the empty state (no need to teach the
  // affordance twice — the empty state has its own CTA).
  // Desktop populated state — pair of buttons in the layer-bar's
  // right slot. Black (primary) opens the manual new-scene sheet;
  // white (secondary) opens the insertion-point popup, then fires
  // a single-scene AI add. Mobile keeps the legacy bulk
  // "Add All Scenes" chip.
  const v2ScenesActions = isV2 && hasBeats ? (
    isDesktop ? (
      <div className="v2-add-one-actions">
        <button
          type="button"
          className="add-one-chip-primary"
          onClick={() => openNewScene(beats.length)}
          disabled={aiSceneBusy || genBusy}
        >
          <img src="/icon-add-cta.svg" alt="" aria-hidden="true" />
          <span>Add a Scene</span>
        </button>
        <button
          type="button"
          className="add-one-chip"
          onClick={() => {
            // Default to "at the end" so a single confirm without
            // touching the picker drops the new scene after the
            // current last beat.
            setAiScenePickedIdx(beats.length - 1);
            setAiSceneInsertOpen(true);
          }}
          disabled={aiSceneBusy || genBusy}
        >
          <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
          <span>{aiSceneBusy ? "Creating…" : "Add a Scene"}</span>
        </button>
      </div>
    ) : (
      <button
        type="button"
        className="add-all-scenes-chip"
        onClick={generateAllBeats}
        disabled={genBusy}
      >
        <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
        <span>{genBusy ? "Creating…" : "Add All Scenes"}</span>
      </button>
    )
  ) : null;

  return (
    <>
      <LayerBar
        layer="story"
        label="Story"
        story={story}
        setStory={setStory}
        autosaveEnabled={autosaveEnabled}
        onOpenUpdateTray={onOpenUpdateTray}
        rightSlot={v2ScenesActions}
      />

      {/* Desktop AI single-scene insertion popup. Opens when the
          user clicks the white "Add a Scene" chip; user picks
          where to drop the new beat (start / after scene N), then
          confirm fires `generate_beat` and inserts the returned
          scene at that position. Closes on scrim click or Cancel. */}
      {aiSceneInsertOpen && (
        <div
          className="v2-ai-scene-insert-scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Where should the new scene go?"
          onClick={() => !aiSceneBusy && setAiSceneInsertOpen(false)}
        >
          <div
            className="v2-ai-scene-insert-card"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="v2-ai-scene-insert-title">Where should this scene go?</h3>
            <p className="v2-ai-scene-insert-caption">
              Pick where AI should drop the new scene. It&apos;ll be inserted just after the scene you choose.
            </p>
            <label className="v2-ai-scene-insert-field">
              <span className="v2-ai-scene-insert-field-label">Insert position</span>
              <select
                className="v2-ai-scene-insert-select"
                value={aiScenePickedIdx ?? -1}
                onChange={e => setAiScenePickedIdx(parseInt(e.target.value, 10))}
                disabled={aiSceneBusy}
              >
                <option value={-1}>At the beginning</option>
                {beats.map((b, i) => (
                  <option key={b.id} value={i}>
                    After scene {i + 1}: {b.name || "Untitled scene"}
                  </option>
                ))}
              </select>
            </label>
            <div className="v2-ai-scene-insert-actions">
              <button
                type="button"
                className="v2-ai-scene-insert-cancel"
                onClick={() => setAiSceneInsertOpen(false)}
                disabled={aiSceneBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v2-ai-scene-insert-confirm"
                onClick={() => addOneScene(aiScenePickedIdx ?? -1)}
                disabled={aiSceneBusy}
              >
                {aiSceneBusy ? "Creating…" : "Create Scene"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top-of-content Tip — only surfaces once the user has added a
          first scene. The empty state carries its own teaching; a tip
          on top of that would double the noise at first paint. */}
      {hasBeats && !isV2 && (
        <Tip id="story-scenes-are-building-blocks" persist={false}>
          Scenes are the building blocks of your script — long-press any scene to drag and reorder.
        </Tip>
      )}

      <div className={draggingIdx != null ? "beats-dragging" : ""}>
        {!hasBeats && (
          <>
            <EmptyLayerState
              section="story"
              layer="story"
              draftPickerLabel="Story"
              story={story}
              setStory={setStory}
              autosaveEnabled={autosaveEnabled}
              icon={<img src="/story-icon.svg" width={49} height={41} alt="" />}
              title={isV2 ? "Create the Key Scenes" : "No scenes yet"}
              caption={
                isV2
                  ? "Build your story outline. Add scenes, and key moments to bring your idea to life."
                  : "Start building your story structure — add your first scene."
              }
              addLabel={isV2 ? "Add a Scene" : "Add scene"}
              onAdd={() => openNewScene(0)}
              onGenerate={generateAllBeats}
              generating={genBusy}
              generateLabel={isV2 ? "Create With AI" : "Write all with AI"}
              generatingLabel="Writing…"
            />

            {/* Direction card — only in the Story-tab empty state. Lets the
                user provide free-text guidance that the AI weights when
                generating scenes. Persists on the active story-layer draft;
                read by the prompt builder via getActiveStoryLayerDraft. */}
            <div className="card import-script-card" style={{ marginTop: 47 }}>
              <span className="eyebrow">Have direction in mind?</span>
              <div className="caption" style={{ marginTop: 6, marginBottom: 12 }}>
                Tell the AI how you want the scenes to play out — general or
                specific. Your guidance steers scene generation when you tap
                "Write all with AI."
              </div>
              <Button
                variant="secondary"
                size="lg"
                block
                onClick={() => setDirectionSheetOpen(true)}
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                }
              >
                {direction.trim() ? "Edit Direction" : "Add Direction"}
              </Button>
              {direction.trim() && (
                <div
                  className="caption"
                  style={{
                    marginTop: 10,
                    fontStyle: "italic",
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                  }}
                >
                  &ldquo;{direction}&rdquo;
                </div>
              )}
            </div>
          </>
        )}

        {beats.map((beat, i) => {
          const isDragging = draggingIdx === i;

          return (
            <div key={beat.id} ref={el => { beatRefs.current[i] = el; }} className={isV2 ? "v2-beat-row" : undefined}>
              {/* Drop indicator before this beat */}
              <div className={`beat-drop-indicator ${draggingIdx != null && dropTargetIdx === i && dropTargetIdx !== draggingIdx && dropTargetIdx !== draggingIdx + 1 ? "active" : ""}`} />
              {isV2 && (
                <div className="v2-beat-number-col" aria-hidden="true">
                  <span className={`v2-beat-number-badge ${beat.status === "written" ? "written" : ""}`}>
                    {i + 1}
                  </span>
                </div>
              )}
              <div
                className={`beat-card ${isV2 ? "v2-beat-card" : ""} ${isDragging ? "dragging" : ""}`}
                onTouchStart={(e) => {
                  const y = e.touches[0].clientY;
                  touchStartY.current = y;
                  isDragActive.current = false;
                  const cardEl = beatRefs.current[i]?.querySelector(".beat-card") as HTMLElement | null;
                  longPressTimer.current = setTimeout(() => {
                    isDragActive.current = true;
                    setDraggingIdx(i);
                    setDropTargetIdx(i);
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
                  if (isDragActive.current) {
                    // Suppress the synthetic click that fires next so
                    // we don't navigate into the popup immediately
                    // after dragging the same row.
                    dragJustEnded.current = true;
                    setTimeout(() => { dragJustEnded.current = false; }, 200);
                  }
                  isDragActive.current = false;
                  setDraggingIdx(null);
                  setDropTargetIdx(null);
                }}
              >
                <div className="beat-header" style={isV2 ? undefined : { display: "flex", alignItems: "center", gap: 0 }}>
                  <div className="beat-grip" aria-hidden="true">
                    {isV2 ? (
                      <img src="/icon-row-move.svg" alt="" aria-hidden="true" width={6} height={14} />
                    ) : "⠿"}
                  </div>
                  <button
                    style={isV2 ? { display: "flex", alignItems: "stretch", flex: 1, padding: 0, textAlign: "left", background: "none", border: "none" } : { display: "flex", alignItems: "center", gap: 12, flex: 1, padding: "16px 16px 16px 4px", textAlign: "left", background: "none", border: "none" }}
                    onClick={() => {
                      if (isDragActive.current || dragJustEnded.current) return;
                      // v2: tap opens the preview popup first, which has
                      // an "Edit Scene" CTA that hands off to the full
                      // sheet. v1: legacy behavior — open the sheet
                      // directly.
                      if (isV2 && openScenePopup) openScenePopup(beat.id);
                      else openExistingScene(beat.id);
                    }}
                  >
                  {isV2 && (
                    /* In-flight check FIRST — regenerate visibly replaces
                       the old thumb with shimmer instead of sitting
                       invisibly behind it. */
                    scenesInFlight.has(beat.id)
                      ? <div className="v2-beat-thumb ds-image-shimmer is-dark" aria-label="Generating scene image" />
                      : beat.thumbnail
                        ? <img src={beat.thumbnail} alt="" className="v2-beat-thumb" />
                        : <div className="v2-beat-thumb v2-beat-thumb-placeholder">{(beat.name || "?").charAt(0).toUpperCase()}</div>
                  )}
                  <div className={`beat-number ${beat.status === "written" ? "written" : ""}`}>
                    {i + 1}
                  </div>
                  <div className="beat-info">
                    {/* Slugline / scene heading — formatSlugline
                        composes `location` + `timeOfDay` and applies
                        the INT/EXT default. Returns null when both
                        fields are empty, in which case the row is
                        suppressed. CSS hides this on mobile (the
                        slugline display is desktop-only per spec). */}
                    {isV2 && (() => {
                      const slug = formatSlugline(beat.location, beat.timeOfDay);
                      if (!slug) return null;
                      return <div className="v2-beat-location ds-type-int-heading">{slug}</div>;
                    })()}
                    <div className={`beat-name${isV2 ? " ds-type-project-card-title" : " ds-type-body-bold"}`}>{beat.name || "Untitled scene"}</div>
                    <div className={`beat-summary-preview${isV2 ? " ds-type-body" : ""}`}>{beat.summary || "No summary"}</div>
                  </div>
                  {isV2 && (() => {
                    // Right-side meta column: character chips + estimated
                    // duration. Both are conditional — characters only
                    // render when beat.characterIds is populated, duration
                    // only when sceneContent yields a non-zero estimate.
                    const charIds = beat.characterIds ?? [];
                    const charNames = charIds
                      .map(id => charNameMap.get(id))
                      .filter((n): n is string => typeof n === "string" && n.length > 0);
                    const minutes = estimateBeatMinutes(beat);
                    if (charNames.length === 0 && minutes === null) return null;
                    return (
                      <div className="v2-beat-meta">
                        {charNames.length > 0 && (
                          <div className="v2-beat-meta-chars">
                            <img
                              src="/v2/icons/icon-characters.svg"
                              alt=""
                              aria-hidden="true"
                              className="v2-beat-meta-icon"
                            />
                            <ul className="v2-beat-meta-char-list">
                              {charNames.slice(0, 4).map((name, idx) => (
                                <li key={idx}>{name}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {minutes !== null && (
                          <div className="v2-beat-meta-duration">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="9" />
                              <polyline points="12 7 12 12 15 14" />
                            </svg>
                            <span>{minutes} min</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {!isV2 && beat.momentIds.length > 0 && (
                    <span className="caption" style={{ flexShrink: 0 }}>
                      {beat.momentIds.length}m
                    </span>
                  )}
                  <span className="beat-expand">›</span>
                  </button>
                  {isV2 && (
                    <span className="v2-beat-menu" aria-hidden="true">
                      <img src="/icon-options.svg" alt="" />
                    </span>
                  )}
                </div>
              </div>

              {i === beats.length - 1 && (
                <div className={`beat-drop-indicator ${draggingIdx != null && dropTargetIdx === beats.length && dropTargetIdx !== draggingIdx && dropTargetIdx !== draggingIdx + 1 ? "active" : ""}`} />
              )}

              {/* Inter-row "+ Add scene" button kept for v1 only — v2
                  uses just the persistent bottom sticky bar. */}
              {!isV2 && (
                <div className="beat-insert-row">
                  <button
                    className="beat-insert-btn"
                    onClick={() => openNewScene(i + 1)}
                    aria-label="Insert scene here"
                  >
                    + Add scene
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom sticky "Add scene" bar is mobile-only — same logic
          as the Characters tab. Desktop already exposes BOTH a
          manual add chip and an AI add chip inline with the
          LayerBar at the top of the tab, so the persistent
          bottom bar would be redundant on a wide viewport. */}
      {hasBeats && !isDesktop && (
        <>
          <div className="layer-sticky-bar-spacer" aria-hidden="true" />
          <LayerStickyBar
            label="Add scene"
            onClick={() => openNewScene(beats.length)}
            disabled={genBusy}
            icon={<span style={{ fontSize: 18, lineHeight: 1, fontWeight: 300 }}>+</span>}
          />
        </>
      )}

      {/* Direction sheet — opens from the empty-state card above. Holds a
          single textarea bound to the active story-layer draft's direction
          field. Autosaves on each keystroke; close button is the only exit. */}
      <div
        className={`sheet-backdrop ${directionSheetOpen ? "open" : ""}`}
        onClick={() => setDirectionSheetOpen(false)}
      />
      <div className={`sheet sheet-tall ${directionSheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">Direction</div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDirectionSheetOpen(false)}
          >
            Close
          </Button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <Textarea
            value={direction}
            onChange={e =>
              setStory(s => updateStoryLayerDraft(s, { direction: e.target.value }))
            }
            placeholder="Describe how you want the scenes to play out — general or specific. The AI will use this as guidance when writing scenes."
            rows={10}
            showClear={false}
            autoFocus={directionSheetOpen}
          />
        </div>
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
  moments,
  run,
  busy,
  autosaveEnabled = true,
  onOpenUpdateTray,
  onOpenReadThrough,
  onImportScript,
  onImportPastedScript,
  onImportStoryDescription,
  importing,
  importStep,
  onAddScene,
  onGoToStory,
  openScenePopup,
  openScriptViewSheet,
  openScriptViewSheetHighlight,
  runGenerateAll,
  bgScriptJob,
  onStartBackgroundScriptLoop,
  scenesInFlight,
  charsInFlight,
  onEditScene,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  beats: Beat[];
  /** Forwarded from Studio so scene cards can render the moment text
   *  + type of everything the user linked in the Story tab. */
  moments: Moment[];
  /** v2 desktop only — shimmer state for the right pane's scene
   *  image and character avatars. Same shape as Story / Characters
   *  tabs use; lets the pane mirror inflight regenerate state. */
  scenesInFlight: Set<string>;
  charsInFlight: Set<string>;
  /** v2 desktop only — opens the existing-scene edit sheet from
   *  the Edit Scene chip overlayed on the right pane's scene image
   *  (unwritten variant). Same action the legacy ScenePopup's Edit
   *  Scene button fires. */
  onEditScene: (beatId: string) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
  autosaveEnabled?: boolean;
  onOpenUpdateTray: (source: LayerKey) => void;
  /** Open the read-through sheet — Studio owns state, ScriptTab just triggers. */
  onOpenReadThrough: () => void;
  /** Import a .txt/.pdf screenplay; deterministically populates
   *  Script + Characters + Story layers from the file contents. */
  onImportScript: (file: File) => Promise<void>;
  /** Import a screenplay the user has pasted as plain text. Same
   *  4-step pipeline as `onImportScript` — just skips the file→text
   *  extraction step. */
  onImportPastedScript: (text: string) => Promise<void>;
  /** Import a free-form story description (not a screenplay) the user
   *  has pasted. Seeds the Concept summary and runs concept → story →
   *  characters → script in order so every layer is generated from
   *  the description. */
  onImportStoryDescription: (text: string) => Promise<void>;
  importing: boolean;
  /** Which layer is currently being written (drives progress label). */
  importStep: LayerKey | null;
  /** Switch to Story tab + open the scene-creation tray.
   *  Wired by Studio because scenes (beats) are created in Story. */
  onAddScene: () => void;
  /** Switch to the Story tab without opening any tray. Wired into
   *  the v2 empty-state CTA ("Go to Story") since Script can only
   *  ever be empty when Story is empty too. */
  onGoToStory: () => void;
  /** v2 only — open the lightweight scene preview popup. Same prop
   *  shape as StoryTab; ScriptTab forwards a row click to it. */
  openScenePopup?: (beatId: string) => void;
  /** v2 only — open the full-prose Script View sheet (read mode
   *  with prev/next nav, scrollable screenplay text). Fired by
   *  written scene rows / chips. */
  openScriptViewSheet?: (beatId: string) => void;
  /** v2 desktop only — open the ScriptViewSheet with highlight mode
   *  pre-armed. Fired by the HM button on the right pane so the user
   *  immediately enters the drag-to-highlight + composer flow (same
   *  one Read-through uses). */
  openScriptViewSheetHighlight?: (beatId: string) => void;
  /** Wrap a Create-all action with the Studio-level scrim + sheet-close
   *  choreography. See `runGenerateAll` in Studio. */
  runGenerateAll: (fn: () => Promise<void>) => Promise<void>;
  /** Background script-generation job state, when one is running for
   *  this project. Drives per-beat spinner cards (inflight + queued)
   *  and disables the bulk "Write all scenes with AI" button so we
   *  don't kick off a second loop on top of the first. */
  bgScriptJob?: {
    inflightBeatId: string | null;
    pendingBeatIds: Set<string>;
  } | null;
  /** Forwarded from Studio. The "Write all scenes with AI" button calls
   *  this — page.tsx orchestrates the loop, returning a Promise that
   *  resolves once scene 1 lands so we can dismiss the scrim.
   *
   *  `opts.rewriteNewDraft` switches the button into rewrite mode:
   *  page.tsx clones the active story+script layer drafts and clears
   *  every beat to "design" before the loop runs, so the prior prose
   *  is preserved on the older draft. Studio sets this when there's
   *  already at least one written scene. */
  onStartBackgroundScriptLoop?: (
    story: Story,
    profile?: WriterProfile | null,
    opts?: { rewriteNewDraft?: boolean },
  ) => Promise<void>;
}) {
  const isV2 = useIsV2();
  const isDesktop = useIsDesktopStudio();
  const d = getActiveScriptDraft(story);
  const charactersDraft = getActiveCharactersDraft(story);
  const conceptDraft = getActiveConceptDraft(story);
  const writtenCount = beats.filter(b => b.status === "written").length;
  const hasProducedScript = writtenCount > 0;
  const hasBeats = beats.length > 0;

  // ── v2 desktop two-column selection state ──────────────────────
  // On desktop the Script tab renders as [scene list | scene pane].
  // selectedBeatId drives which beat the right pane mirrors. We
  // auto-select the first beat when none is selected (initial mount
  // or after a beats reset) so the pane never sits empty when a
  // selection is possible. On mobile this state is harmless (cards
  // still route to popup / sheet).
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  // Highlight mode toggle for the written-scene pane's HM button.
  // Pressed state is reflected on the button via aria-pressed +
  // `.is-active` for future styling; functional drag-highlight
  // behaviour is owned by the existing ScriptViewSheet and will be
  // ported in a follow-up — the button + state hook are wired now
  // so the visual affordance is in place.
  const [highlightModeOn, setHighlightModeOn] = useState(false);
  useEffect(() => {
    if (beats.length === 0) {
      if (selectedBeatId !== null) setSelectedBeatId(null);
      return;
    }
    if (selectedBeatId === null || !beats.find(b => b.id === selectedBeatId)) {
      setSelectedBeatId(beats[0].id);
    }
  }, [beats, selectedBeatId]);

  // "Write all scenes with AI" — kicks off the same background-loop
  // machinery Easy mode uses. The scrim from runGenerateAll covers
  // exactly the FIRST scene's generation; once scene 1 lands, the
  // promise resolves, the scrim closes, and scenes 2..N continue
  // streaming into the Script tab via per-beat spinner cards.
  //
  // Why this delegates to page.tsx (via onStartBackgroundScriptLoop):
  //   - The loop's state (bgScriptJob) lives at page.tsx scope so it
  //     survives Studio unmounting (user navigates back to home or to
  //     another project mid-loop). The same machinery that powers
  //     Easy mode's hand-off — same persistence, same spinner UX.
  //   - This replaces what used to be ~80 lines of inline streaming
  //     code that duplicated lib/syncLayer.ts's callGenerate without
  //     persisting per iteration. The new path persists each scene
  //     before the next, so a tab close mid-loop loses only the
  //     in-flight scene; everything before it is durable.
  //
  // Rules preserved:
  //   - Skip beats that already have prose (filtered by scriptLoop's
  //     pendingBeatIds — same status/sceneContent check).
  //   - On any failure, the loop stops and clears bgScriptJob; scenes
  //     written so far survive. The button re-enables so the user can
  //     resume by clicking again (queue picks up at first unwritten).
  const { profile } = useProfileCapture();
  const [genBusy, setGenBusy] = useState(false);
  // When ANY scene has prose, the bulk button switches into rewrite
  // mode: page.tsx clones the story-layer + script-layer drafts and
  // clears every beat before the loop runs, so the prior prose is
  // preserved on the older draft. The label flips to "Rewrite all
  // scenes with AI (New Draft)" so the destructive intent is explicit.
  // No prior prose → first-write mode (overwrite empty draft, no clone).
  const isRewriteMode = writtenCount > 0;
  async function generateAllScript() {
    if (genBusy || bgScriptJob || !onStartBackgroundScriptLoop) return;
    setGenBusy(true);
    try {
      await runGenerateAll(async () => {
        // Resolves when scene 1 is written + persisted (or the loop
        // terminates early — empty queue / error). Scenes 2..N keep
        // generating in the background after this returns.
        await onStartBackgroundScriptLoop(story, profile, {
          rewriteNewDraft: isRewriteMode,
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof window !== "undefined") window.alert(msg);
    } finally {
      setGenBusy(false);
    }
  }

  // v2 right-slot actions for the Script layer-bar — "Script All
  // Scenes" chip (kicks off the same bulk-script loop the bottom
  // sticky button uses) + a small Read-through chip so the user can
  // open the formatted screen anywhere from the Script tab. Mirrors
  // the Add All Scenes / Add All Characters chip styling.
  const v2ScriptActions = isV2 && hasBeats ? (
    <div className="v2-script-actions">
      <button
        type="button"
        className="add-all-scenes-chip"
        onClick={() => {
          if (genBusy || !!bgScriptJob || !onStartBackgroundScriptLoop) return;
          setGenBusy(true);
          runGenerateAll(async () => {
            try {
              await onStartBackgroundScriptLoop(story, profile, { rewriteNewDraft: hasProducedScript });
            } finally {
              setGenBusy(false);
            }
          });
        }}
        disabled={genBusy || !!bgScriptJob}
      >
        <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
        <span>{genBusy || bgScriptJob ? "Scripting…" : "Script All Scenes"}</span>
      </button>
      {(() => {
        // Download / send chip. Active only when every beat in
        // the active draft has prose written. The visual style
        // switches via the `.is-active` class — dark fill +
        // white glyph when ready to download, light fill +
        // muted glyph otherwise. Disabled state is a no-op
        // click (the action itself isn't wired yet).
        const allScripted = hasBeats && writtenCount === beats.length;
        return (
          <button
            type="button"
            className={`v2-script-readthrough-btn ${allScripted ? "is-active" : ""}`}
            onClick={allScripted ? onOpenReadThrough : undefined}
            disabled={!allScripted}
            aria-label={allScripted ? "Download or send the script" : "Script every scene to enable download"}
            title={allScripted ? "Download / send" : "Script every scene to enable"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        );
      })()}
    </div>
  ) : null;

  // Extracted so the same LayerBar element can be rendered in TWO
  // places without duplication: outside the script-desktop-grid for
  // the empty state and v1 path, OR inside the grid (as the first
  // row spanning both columns) for the v2 populated path. The
  // previous always-outside placement meant the SCRIPT DRAFT pill
  // + Script All Scenes + Download chips lived in a visual bar
  // that was a sibling of the content grid — when the columns
  // pinned via sticky, the bar would scroll away in a way that
  // felt disconnected. Putting it inside the grid keeps it in the
  // same container as the cards/pane so they scroll as one piece.
  const scriptLayerBar = (
    <LayerBar
      layer="script"
      label="Script"
      story={story}
      setStory={setStory}
      autosaveEnabled={autosaveEnabled}
      onOpenUpdateTray={onOpenUpdateTray}
      onOpenReadThrough={hasProducedScript && !isV2 ? onOpenReadThrough : undefined}
      /* Action chips (Script All Scenes + Download) live in the
         LayerBar's right slot on every viewport. Desktop CSS
         (.tab-content-wrap-script .layer-bar-right-slot) drops
         the bar's right-slot `margin-left: auto` so the chips
         sit immediately to the right of the SCRIPT DRAFT
         dropdown rather than at the bar's far right edge. */
      rightSlot={v2ScriptActions}
    />
  );

  return (
    <>
      {/* onOpenReadThrough gated on hasProducedScript: the read-through
          sheet renders written scene prose, so the icon is meaningless
          when the Script tab is in its empty state (no beats written).
          Passing `undefined` tells LayerBar to skip the button entirely. */}
      {(!isV2 || !hasBeats) && scriptLayerBar}

      {/* Top-of-content Tip — only surfaces once at least one scene
          has been written. On an empty Script the empty state already
          carries the primary teaching; this tip would pile on. */}
      {hasProducedScript && !isV2 && (
        <Tip id="script-scenes-from-outline" persist={false}>
          Every scene in the Story tab becomes prose here — the tighter your outline, the smoother the draft.
        </Tip>
      )}

      {/* Previously rendered a "{writtenCount}/{beats.length} scenes
          written." caption at the top of the Script tab. Removed per
          product direction — the per-scene cards already communicate
          written vs. unwritten state visually (prose vs. "Write this
          scene" button), so the aggregate counter was noisy overhead. */}

      {!hasBeats && (
        // Script can only be empty when Story is empty too — there's
        // nothing here to "create", just a navigation back to Story
        // where scenes get authored. v2 surfaces a single "Go to
        // Story" CTA (back-arrow glyph in the primary black chip).
        // v1 keeps the prior info-only treatment (no buttons).
        <EmptyLayerState
          section="script"
          layer="script"
          draftPickerLabel="Script"
          story={story}
          setStory={setStory}
          autosaveEnabled={autosaveEnabled}
          icon={<img src="/script-icon.svg" width={40} height={39} alt="" />}
          title={isV2 ? "No Scenes to Script Yet" : "No scenes yet"}
          caption={
            isV2
              ? "Build your scenes in Story first, then come back here to turn them into a script."
              : "Sketch scenes in the Story tab, then return here to write them into prose."
          }
          addLabel={isV2 ? "Go to Story" : undefined}
          onAdd={isV2 ? onGoToStory : undefined}
          addIcon={isV2 ? <img src="/v2/icons/icon-back.svg" alt="" aria-hidden="true" /> : undefined}
        />
      )}

      {/* v2 layout — number column with dotted timeline + card with
          slug line, big serif title, body, page-range and per-scene
          AI chip. Mirrors the Story tab's row pattern.
          The .v2-script-desktop-grid wrapper is `display: contents`
          on mobile (passthrough — children float up to be direct
          children of .tab-content-wrap-script and the legacy mobile
          single-column layout keeps working) and a 2-column grid on
          desktop (≥1440), pairing the .v2-script-list of scene
          cards with a .v2-script-pane on the right. */}
      {isV2 && hasBeats && (
      <div className="v2-script-desktop-grid">
      {scriptLayerBar}
      <div className="v2-script-list">
      {beats.map((beat, i) => {
        // Estimate page range from accumulated word counts. Standard
        // screenplay convention: 1 page ≈ 250 words. We accumulate
        // pages from prior beats, so beat i's range starts where
        // beat i-1's ended + 1.
        let cumStart = 1;
        for (let j = 0; j < i; j++) {
          const w = (beats[j].sceneContent || beats[j].summary || "").trim().split(/\s+/).filter(Boolean).length;
          cumStart += Math.max(1, Math.round(w / 250));
        }
        const w = (beat.sceneContent || beat.summary || "").trim().split(/\s+/).filter(Boolean).length;
        const pages = Math.max(1, Math.round(w / 250));
        const pageEnd = cumStart + pages - 1;
        const pageLabel = pages > 1 ? `p. ${cumStart} - ${pageEnd}` : `p. ${cumStart}`;
        // Slug line — extract the first INT./EXT. line from
        // sceneContent. Falls back to a generic "SCENE" pre-script.
        const slugMatch = (beat.sceneContent || "").match(/^\s*(?:INT\.?|EXT\.?|INT\.?\/EXT\.?)\s+[^\n]+/im);
        const slug = (slugMatch?.[0] ?? "SCENE").trim().toUpperCase();
        const isWritten = beat.status === "written";
        const isInflight = bgScriptJob?.inflightBeatId === beat.id;
        const isQueued = !isInflight && bgScriptJob?.pendingBeatIds.has(beat.id) === true;
        return (
          <div
            key={beat.id}
            className={`v2-script-row${isDesktop && selectedBeatId === beat.id ? " is-selected" : ""}`}
          >
            <div className="card v2-script-card beat-card">
              <span className={`v2-script-number-badge ${isWritten ? "written" : ""}`} aria-hidden="true">
                {i + 1}
              </span>
              {!isDesktop && (
                <button
                  type="button"
                  className="v2-script-options"
                  aria-label="Scene options"
                >
                  <img src="/icon-options.svg" alt="" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="v2-script-card-tap"
                onClick={() => {
                  // Desktop: clicking the card body selects the scene
                  // for the right pane (no popup / sheet — the prose
                  // and details render inline). Mobile keeps the
                  // legacy behavior: written scenes open the
                  // full-prose Script View sheet, unwritten open the
                  // lightweight preview popup.
                  if (isDesktop) {
                    setSelectedBeatId(beat.id);
                  } else if (isWritten) {
                    openScriptViewSheet?.(beat.id);
                  } else {
                    openScenePopup?.(beat.id);
                  }
                }}
              >
                <div className="v2-script-slug ds-type-int-header">{slug}</div>
                <div className="v2-script-name ds-type-project-card-title">{beat.name || "Untitled scene"}</div>
                <p className="v2-script-summary ds-type-body">{beat.summary || "No summary yet."}</p>
              </button>
              <div className="v2-script-footer">
                <span className="v2-script-pages ds-type-body">{pageLabel}</span>
                {/* Written-scene footer on desktop is a non-interactive
                    "SCRIPTED" indicator — green-check icon + label,
                    same typography as the Script Scene chip below.
                    Mobile keeps the legacy "View Script" chip that
                    opens the script-view sheet. */}
                {isWritten ? (
                  isDesktop ? (
                    <span className="v2-script-scripted-indicator" aria-label="Scripted">
                      <img
                        src="/icon-scripted.svg"
                        alt=""
                        aria-hidden="true"
                        className="v2-script-scripted-indicator-icon"
                      />
                      <span>Scripted</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="add-all-scenes-chip v2-script-scene-chip"
                      onClick={() => openScriptViewSheet?.(beat.id)}
                    >
                      <img
                        src="/icon-script-sml.svg"
                        alt=""
                        aria-hidden="true"
                        width={10.86}
                        height={11.27}
                      />
                      <span>View Script</span>
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="add-all-scenes-chip v2-script-scene-chip"
                    onClick={() => {
                      if (busy || isInflight || isQueued) return;
                      run(
                        { type: "generate_scene", payload: { beatIndex: i } },
                        `Write · ${beat.name}`,
                      );
                    }}
                    disabled={busy || isInflight || isQueued}
                  >
                    <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
                    <span>
                      {isInflight ? "Scripting…" : isQueued ? "Queued" : "Script Scene"}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      </div>
      {isDesktop && (() => {
        // ── Right pane: scene detail (unwritten) or script prose (written)
        // Renders inline alongside the .v2-script-list on ≥1440. Below
        // 1440 the CSS collapses .v2-script-desktop-grid to display:contents
        // and we don't render the pane at all (the early `if (!isDesktop)`
        // gate above the IIFE ensures the work is skipped on mobile).
        const idx = beats.findIndex(b => b.id === selectedBeatId);
        const beat = idx >= 0 ? beats[idx] : null;
        if (!beat) return null;
        const total = beats.length;
        const cast = getActiveCharactersDraft(story).characters;
        const beatChars = (beat.characterIds ?? [])
          .map(id => cast.find(c => c.id === id))
          .filter((c): c is Character => !!c);
        // Duration shown on the scene image. Resolution order:
        //   1. `beat.lengthMinutes` — the explicit time the user
        //      picked in the scene-edit sheet (whole or fractional
        //      minutes). Takes precedence per spec.
        //   2. Word-count estimate from sceneContent at 250 wpm.
        //   3. "—:—" when neither source has a value.
        const durationLabel = (() => {
          if (typeof beat.lengthMinutes === "number" && beat.lengthMinutes > 0) {
            const totalSeconds = Math.max(1, Math.round(beat.lengthMinutes * 60));
            const m = Math.floor(totalSeconds / 60);
            const s = totalSeconds % 60;
            return `${m}:${s.toString().padStart(2, "0")}`;
          }
          const wordCount = (beat.sceneContent || "").trim().split(/\s+/).filter(Boolean).length;
          if (wordCount === 0) return "—:—";
          const seconds = Math.max(1, Math.round((wordCount / 250) * 60));
          const m = Math.floor(seconds / 60);
          const s = seconds % 60;
          return `${m}:${s.toString().padStart(2, "0")}`;
        })();
        const isWritten = beat.status === "written";
        const isInflight = bgScriptJob?.inflightBeatId === beat.id;
        const isQueued = !isInflight && bgScriptJob?.pendingBeatIds.has(beat.id) === true;
        return (
          <div
            className={`v2-script-pane v2-script-pane-${isWritten ? "written" : "unwritten"}`}
            role="region"
            aria-label={`Scene ${idx + 1} of ${total}: ${beat.name || "Untitled"}`}
          >
            {/* PERSISTENT top — actions + scene info. Always rendered
                regardless of `isWritten` so they stay in place when
                the user switches between scripted and unscripted
                scenes (React keeps the same DOM nodes; only the text
                content of the SCENE label / title updates). They
                also live OUTSIDE the .v2-script-pane-body scroll
                region below, so they remain visible while the body
                content scrolls under them. */}
            <div className="v2-script-pane-actions">
              <div className="v2-script-pane-actions-group">
                <button
                  type="button"
                  className="v2-script-pane-nav-btn"
                  onClick={() => idx > 0 && setSelectedBeatId(beats[idx - 1].id)}
                  disabled={idx === 0}
                  aria-label="Previous scene"
                >
                  <img
                    src="/icon-prev-next.svg"
                    alt=""
                    aria-hidden="true"
                    className="v2-script-pane-nav-btn-icon v2-script-pane-nav-btn-icon-prev"
                  />
                </button>
                <button
                  type="button"
                  className="v2-script-pane-nav-btn"
                  onClick={() => idx < beats.length - 1 && setSelectedBeatId(beats[idx + 1].id)}
                  disabled={idx === beats.length - 1}
                  aria-label="Next scene"
                >
                  <img
                    src="/icon-prev-next.svg"
                    alt=""
                    aria-hidden="true"
                    className="v2-script-pane-nav-btn-icon"
                  />
                </button>
              </div>
              {/* HM + Play only render for SCRIPTED scenes — they
                  operate on the prose (HM toggles drag-highlight on
                  the screenplay text; Play opens the read-through
                  sheet which renders scene prose). Prev/Next above
                  remain visible always since they navigate the
                  scene list regardless of scripted state. */}
              {isWritten && (
                <div className="v2-script-pane-actions-group">
                  <button
                    type="button"
                    className="v2-script-pane-mode-btn"
                    onClick={() => {
                      // Local visual toggle (button pressed state)
                      setHighlightModeOn(true);
                      // Open the ScriptViewSheet for THIS scene with
                      // highlight mode pre-armed. The sheet owns the
                      // drag-to-highlight + composer flow — same one
                      // Read-through uses — so the desktop pane just
                      // delegates rather than re-implementing it.
                      openScriptViewSheetHighlight?.(beat.id);
                      // Reset our local pressed state shortly after
                      // — by the time the sheet renders the button
                      // visually settling back to off is fine; the
                      // sheet's HM toggle is the source of truth
                      // once it's open.
                      window.setTimeout(() => setHighlightModeOn(false), 250);
                    }}
                    aria-pressed={highlightModeOn}
                    aria-label="Highlight mode"
                    title="Highlight mode"
                  >
                    <img
                      src="/icon-highlight-mode.svg"
                      alt=""
                      aria-hidden="true"
                      className="v2-script-pane-mode-btn-icon-hm"
                    />
                  </button>
                  <button
                    type="button"
                    className="v2-script-pane-mode-btn"
                    onClick={onOpenReadThrough}
                    aria-label="Play read-through"
                    title="Play read-through"
                  >
                    <img
                      src="/icon-play.svg"
                      alt=""
                      aria-hidden="true"
                      className="v2-script-pane-mode-btn-icon-play"
                    />
                  </button>
                </div>
              )}
            </div>
            <div className="v2-script-pane-header">
              <div className="v2-script-pane-header-text">
                <span className="v2-script-pane-index ds-type-int-header">
                  SCENE {idx + 1} OF {total}
                </span>
                <h2 className="v2-script-pane-title ds-type-project-page-title-empty">
                  {beat.name || "Untitled scene"}
                </h2>
              </div>
            </div>

            {/* Scrollable body — switches between prose (written) and
                detail-row (unwritten) based on the SELECTED scene.
                The wrapper exists so internal overflow can scroll
                independently while the actions + header above stay
                pinned to the pane's top. */}
            <div className="v2-script-pane-body">
            {isWritten ? (
              /* Written scene → render prose in monospace. The
                 sceneContent string is already in screenplay format
                 (FADE IN / EXT./INT. slugs / action / dialogue blocks)
                 so a <pre> preserves the line breaks exactly. */
              <pre className="v2-script-pane-prose">{beat.sceneContent}</pre>
            ) : (
              <div className="v2-script-pane-detail-row">
                <div className="v2-script-pane-image">
                  {scenesInFlight.has(beat.id)
                    ? <div className="v2-script-pane-image-placeholder ds-image-shimmer is-dark" aria-label="Generating scene image" />
                    : beat.thumbnail
                      ? <img src={beat.thumbnail} alt="" />
                      : <div className="v2-script-pane-image-placeholder" aria-hidden="true" />}
                  {/* Duration pill — bottom-LEFT of the image per spec.
                      Reuses the project hero's "Updated 2d ago" clock
                      SVG so the same glyph reads across the app. */}
                  <div className="v2-script-pane-duration ds-type-body">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <polyline points="12 7 12 12 15 14" />
                    </svg>
                    <span>{durationLabel}</span>
                  </div>
                  {/* Edit Scene chip — overlayed bottom-right of the
                      scene image. Opens the existing-scene edit sheet
                      (same action the legacy ScenePopup's "Edit Scene"
                      button fires). Outline-only chip per spec, no
                      fill, label + border both #E4E3E4. */}
                  <button
                    type="button"
                    className="v2-script-pane-edit-overlay ds-type-selected-option-label"
                    onClick={() => onEditScene(beat.id)}
                    aria-label={`Edit ${beat.name}`}
                  >
                    EDIT SCENE
                  </button>
                </div>
                <div className="v2-script-pane-meta">
                  <p className="v2-script-pane-summary ds-type-body">
                    {beat.summary || "No summary yet."}
                  </p>
                  {beatChars.length > 0 && (
                    <div className="v2-script-pane-characters" aria-label="Characters in this scene">
                      {beatChars.map(c => (
                        charsInFlight.has(c.id)
                          ? <div key={c.id} className="v2-script-pane-avatar ds-image-shimmer is-dark" aria-label="Generating character portrait" />
                          : c.thumbnail
                            ? <img key={c.id} src={c.thumbnail} alt="" className="v2-script-pane-avatar" />
                            : <div key={c.id} className="v2-script-pane-avatar v2-script-pane-avatar-placeholder">
                                {c.name ? c.name[0].toUpperCase() : "?"}
                              </div>
                      ))}
                    </div>
                  )}
                  {/* Primary CTA — inside the meta column (NOT below
                      the detail row) so it sits next to the scene
                      image. `margin-top: auto` in CSS pushes it to
                      the bottom of the column; the column's
                      min-height = image height keeps the button
                      bottom-aligned with the image bottom edge when
                      description + characters are short. */}
                  <button
                    type="button"
                    className="v2-script-pane-cta"
                    onClick={() => {
                      if (busy || isInflight || isQueued) return;
                      run(
                        { type: "generate_scene", payload: { beatIndex: idx } },
                        `Write · ${beat.name}`,
                      );
                    }}
                    disabled={busy || isInflight || isQueued}
                  >
                    <img src="/icon-ai-button.svg" alt="" aria-hidden="true" />
                    <span>
                      {isInflight ? "SCRIPTING…" : isQueued ? "QUEUED" : "SCRIPT THIS SCENE"}
                    </span>
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        );
      })()}
      </div>
      )}

      {!isV2 && beats.map((beat, i) => {
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
              {/* Per-scene action row: Rewrite-with-AI sits left of the
                  SpeakButton so the destructive option is far enough
                  from the play affordance to avoid mis-taps. Hidden
                  when this beat is currently inflight in the bg loop;
                  disabled (but still rendered) while any other AI work
                  is happening, so users can't stack two generations on
                  the same beat. */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
                {bgScriptJob?.inflightBeatId !== beat.id && (
                  <button
                    type="button"
                    className="scene-rewrite-trigger"
                    disabled={busy || !!bgScriptJob}
                    onClick={() => run(
                      { type: "generate_scene", payload: { beatIndex: i } },
                      `Rewrite · ${beat.name}`,
                    )}
                    aria-label={`Rewrite ${beat.name} with AI`}
                    title="Rewrite this scene with AI (overwrites the current prose)"
                  >
                    <AISparkleIcon />
                    <span>Rewrite with AI</span>
                  </button>
                )}
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
          {/* Background-loop states. Take precedence over the "design"
              branch so an unwritten beat that's queued by Easy mode's
              background loop renders a spinner instead of a competing
              "Write this scene with AI" button. Three exclusive cases:
                - inflight: this beat is being generated right now
                - queued:   this beat is waiting behind the inflight one
                - design:   no bgScriptJob touches this beat → existing
                            manual-write button (unchanged) */}
          {beat.status !== "written" && bgScriptJob?.inflightBeatId === beat.id && (
            <div style={{ padding: "0 16px 16px" }}>
              <div className="scene-bg-row">
                <div className="scene-bg-spinner" aria-hidden />
                <span>Writing this scene…</span>
              </div>
            </div>
          )}
          {beat.status !== "written"
            && bgScriptJob?.inflightBeatId !== beat.id
            && bgScriptJob?.pendingBeatIds.has(beat.id) && (
            <div style={{ padding: "0 16px 16px" }}>
              <div className="scene-bg-row queued">
                <div className="scene-bg-spinner" aria-hidden />
                <span>Queued — writing soon…</span>
              </div>
            </div>
          )}
          {beat.status === "design"
            && bgScriptJob?.inflightBeatId !== beat.id
            && !bgScriptJob?.pendingBeatIds.has(beat.id) && (
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
          v1 only — v2 surfaces this through the project-creation
          flow. Avoids duplicating the affordance at the bottom of
          every Script tab in v2. */}
      {!isV2 && (
        <ImportScriptCard
          onImportFile={onImportScript}
          onImportPastedScript={onImportPastedScript}
          onImportStoryDescription={onImportStoryDescription}
          importing={importing}
          importStep={importStep}
        />
      )}

      {/* Sticky bottom action bar — v1 only. v2 uses the
          "Script All Scenes" chip in the layer-bar's right slot
          plus per-row "Script Scene" chips, so a duplicate sticky
          CTA at the bottom would double up. */}
      {!isV2 && beats.length >= 2 && (
        <>
          <div className="layer-sticky-bar-spacer" aria-hidden="true" />
          <LayerStickyBar
            label={
              bgScriptJob
                ? "Writing scenes…"
                : isRewriteMode
                  ? "Rewrite all scenes with AI (New Draft)"
                  : "Write all scenes with AI"
            }
            onClick={generateAllScript}
            // Disable while a background loop is already filling the
            // queue (Easy mode hand-off). Two parallel loops would
            // race for the same beats and double-write.
            disabled={genBusy || !!bgScriptJob}
            icon={<AISparkleIcon />}
          />
        </>
      )}
    </>
  );
}

// ── Import Script card ─────────────────────────────────────────────

function ImportScriptCard({
  onImportFile,
  onImportPastedScript,
  onImportStoryDescription,
  importing,
  importStep,
}: {
  onImportFile: (file: File) => Promise<void>;
  onImportPastedScript: (text: string) => Promise<void>;
  onImportStoryDescription: (text: string) => Promise<void>;
  importing: boolean;
  importStep: LayerKey | null;
}) {
  // Sheet visibility. The card's main button no longer fires a file
  // picker directly — instead it opens this sheet, which exposes the
  // three import paths (file upload, pasted screenplay, pasted story
  // description). Closes automatically once an import kicks off.
  const [sheetOpen, setSheetOpen] = useState(false);

  // Two pasted-text buffers — one per pasteable mode. Kept independent
  // so switching between the two textareas doesn't clobber the user's
  // in-progress paste.
  const [pastedScript, setPastedScript] = useState("");
  const [pastedDescription, setPastedDescription] = useState("");

  // Which paste mode is currently revealed. `null` = both rows are
  // collapsed and the user sees just the three top-level buttons.
  const [pasteMode, setPasteMode] = useState<"script" | "description" | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function openFilePicker() {
    if (importing) return;
    fileInputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setSheetOpen(false);
    await onImportFile(file);
  }

  async function submitPastedScript() {
    if (importing) return;
    const t = pastedScript.trim();
    if (!t) return;
    setSheetOpen(false);
    setPastedScript("");
    setPasteMode(null);
    await onImportPastedScript(t);
  }

  async function submitPastedDescription() {
    if (importing) return;
    const t = pastedDescription.trim();
    if (!t) return;
    setSheetOpen(false);
    setPastedDescription("");
    setPasteMode(null);
    await onImportStoryDescription(t);
  }

  const ctaLabel = importing
    ? (importStep
        ? `Writing ${LAYER_LABEL[importStep]}…`
        : "Importing…")
    : "Import a script";

  // Leading upload glyph for the main CTA — tray-with-up-arrow that
  // reads as "import". Suppressed while importing so the spinner takes
  // the icon slot.
  const uploadGlyph = (
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
  );

  return (
    <>
      <div className="card import-script-card" style={{ marginTop: 47 }}>
        <span className="eyebrow">Have something to start from?</span>
        <div className="caption" style={{ marginTop: 6, marginBottom: 12 }}>
          Upload a screenplay file, paste a script, or paste a story
          description. Unfold fills in scenes, beats, characters, and a
          fresh Concept draft — preserving your title, format, and genres.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          onChange={handleFile}
          style={{ display: "none" }}
        />
        <Button
          variant="secondary"
          size="lg"
          block
          onClick={() => setSheetOpen(true)}
          disabled={importing}
          icon={!importing ? uploadGlyph : undefined}
        >
          {importing && <span className="import-spinner" aria-hidden="true" />}
          {ctaLabel}
        </Button>
        {importing && (
          <div className="caption" style={{ marginTop: 10, textAlign: "center" }}>
            Reading your script and splitting it into scenes…
          </div>
        )}
      </div>

      {/* Import sheet — three options stacked. File-upload button opens
          a native picker; the two paste rows expand inline when tapped
          and reveal a textarea + submit button. Tapping the same row
          again collapses it. */}
      <div
        className={`sheet-backdrop ${sheetOpen ? "open" : ""}`}
        onClick={() => setSheetOpen(false)}
      />
      <div className={`sheet sheet-tall ${sheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">Import</div>
          <Button variant="secondary" size="sm" onClick={() => setSheetOpen(false)}>
            Close
          </Button>
        </div>
        <div className="sheet-body" style={{ whiteSpace: "normal" }}>
          <div className="caption" style={{ marginBottom: 16 }}>
            Choose how you want to bring in your existing material.
          </div>

          {/* Option 1 — Upload file */}
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={openFilePicker}
            disabled={importing}
            icon={uploadGlyph}
            style={{ marginBottom: 12 }}
          >
            Upload script files
          </Button>
          <div className="caption" style={{ marginTop: -6, marginBottom: 18 }}>
            .txt or .pdf screenplay. Split into scenes word-for-word.
          </div>

          {/* Option 2 — Paste a screenplay */}
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => setPasteMode(m => m === "script" ? null : "script")}
            disabled={importing}
            style={{ marginBottom: pasteMode === "script" ? 10 : 12 }}
          >
            Paste a script
          </Button>
          {pasteMode === "script" && (
            <div style={{ marginBottom: 18 }}>
              <Textarea
                value={pastedScript}
                onChange={e => setPastedScript(e.target.value)}
                placeholder="Paste the full screenplay here. Standard format with INT./EXT. scene slugs works best."
                rows={10}
                style={{ width: "100%", marginBottom: 10 }}
                disabled={importing}
              />
              <Button
                variant="primary"
                size="lg"
                block
                disabled={importing || !pastedScript.trim()}
                onClick={submitPastedScript}
              >
                Import this script
              </Button>
            </div>
          )}
          {pasteMode !== "script" && (
            <div className="caption" style={{ marginTop: -6, marginBottom: 18 }}>
              Plain-text screenplay — same processing as the file path.
            </div>
          )}

          {/* Option 3 — Paste a story description */}
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => setPasteMode(m => m === "description" ? null : "description")}
            disabled={importing}
            style={{ marginBottom: pasteMode === "description" ? 10 : 12 }}
          >
            Paste a story description
          </Button>
          {pasteMode === "description" && (
            <div style={{ marginBottom: 18 }}>
              <Textarea
                value={pastedDescription}
                onChange={e => setPastedDescription(e.target.value)}
                placeholder="Describe the story in detail — characters, world, what happens scene by scene. Unfold will turn it into beats, characters, and a screenplay."
                rows={10}
                style={{ width: "100%", marginBottom: 10 }}
                disabled={importing}
              />
              <Button
                variant="primary"
                size="lg"
                block
                disabled={importing || !pastedDescription.trim()}
                onClick={submitPastedDescription}
              >
                Import this description
              </Button>
            </div>
          )}
          {pasteMode !== "description" && (
            <div className="caption" style={{ marginTop: -6 }}>
              Free-form description, not a screenplay. Generates beats,
              characters, and a script from your text.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================================ */
/* ============ SCENE EDIT FORM =============== */
/* ============================================ */

// Pretty type-name table for the Linked-Idea picker. Kept in sync with
// the Moment["type"] union — adding a new type means adding an entry
// here too.
const MOMENT_TYPE_LABELS: Record<Moment["type"], string> = {
  scene: "Scene",
  dialogue: "Dialogue",
  joke: "Joke",
  memory: "Memory",
  character: "Character",
  image: "Image",
  note: "Note",
  dream: "Dream",
};

function SceneEditForm({
  beat, story, moments, isNew, onUpdate, onRemove, autoGenInFlight = false,
}: {
  beat: Beat;
  story: Story;
  moments: Moment[];
  isNew: boolean;
  onUpdate: (patch: Partial<Beat>) => void;
  onRemove: () => void;
  /** True when Studio's bulk auto-gen effect is currently fetching
   *  an AI thumbnail for this scene. Drives the shimmer state on
   *  the form's image box. Composed with the form's local
   *  `imgBusy` (which tracks manual Regenerate clicks). */
  autoGenInFlight?: boolean;
}) {
  const isV2Form = useIsV2();
  const [openAttr, setOpenAttr] = useState<string | null>(null);
  const toggleAttr = (k: string) => setOpenAttr(o => o === k ? null : k);

  // Scene image (re)generation, mirroring CharacterEditForm's
  // portrait flow. Calls the same /api/generate-scene-image
  // endpoint that the auto-fill effect uses; the returned data
  // URL replaces beat.thumbnail.
  const [imgBusy, setImgBusy] = useState(false);
  async function generateSceneImage() {
    if (imgBusy) return;
    const description = [
      beat.name && `Beat: ${beat.name}`,
      beat.summary && `Summary: ${beat.summary}`,
      beat.purpose && `Purpose: ${beat.purpose}`,
    ].filter(Boolean).join("\n");
    if (!description.trim()) {
      if (typeof window !== "undefined") {
        window.alert("Add a scene name + summary before generating an image.");
      }
      return;
    }
    const concept = getActiveConceptDraft(story);
    const primaryGenre = concept.settings?.genres?.[0];
    const projectTone = concept.concept?.tone;
    setImgBusy(true);
    try {
      const res = await fetch("/api/generate-scene-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, genre: primaryGenre, tone: projectTone }),
      });
      const data = await res.json();
      if (data.thumbnail) {
        // Manual scene-image regen: stamp imageGenAttempted=true
        // alongside the thumbnail so the auto-gen effect can never
        // try to step on this beat later (same protection as the
        // character manual path above).
        onUpdate({ thumbnail: data.thumbnail, imageGenAttempted: true });
      } else if (data.error && typeof window !== "undefined") {
        window.alert(data.error);
      }
    } catch (err: any) {
      if (typeof window !== "undefined") window.alert(err?.message || String(err));
    } finally {
      setImgBusy(false);
    }
  }

  // Linked-idea picker: which idea-type the user is currently browsing.
  // Defaults to the first type that has any ideas the moment the user
  // expands the row, but stays whatever they last picked thereafter.
  const [browseIdeaType, setBrowseIdeaType] = useState<Moment["type"] | null>(null);

  // Writer profile — used by Clean Up With AI so the cleaned text
  // tracks the user's recorded voice/preference signature.
  const { profile } = useProfileCapture();
  const [cleaning, setCleaning] = useState(false);

  const linkedIds = beat.momentIds;
  const linkedMoments = linkedIds
    .map(id => moments.find(m => m.id === id))
    .filter(Boolean) as Moment[];

  // Available characters (named only) from the active Characters draft.
  const availableCharacters = getActiveCharactersDraft(story).characters
    .filter(c => c.name && c.name.trim() !== "");
  const selectedCharIds = beat.characterIds ?? [];
  const selectedCharNames = selectedCharIds
    .map(id => availableCharacters.find(c => c.id === id)?.name)
    .filter(Boolean) as string[];

  // Idea-types that have at least one saved idea — used to drive the
  // type picker inside the Linked-Idea AttrRow. If the user hasn't
  // saved any ideas at all we render an empty-state caption instead
  // of the type picker.
  const ideaTypesWithIdeas = (Object.keys(MOMENT_TYPE_LABELS) as Moment["type"][])
    .filter(t => moments.some(m => m.type === t));

  // Header pills for the Linked-Idea row: one pill per type linked,
  // shaped like "1 DREAM" / "2 JOKES" so the user can see distribution
  // at a glance without expanding.
  const linkedTypeCounts = linkedMoments.reduce<Partial<Record<Moment["type"], number>>>((acc, m) => {
    acc[m.type] = (acc[m.type] ?? 0) + 1;
    return acc;
  }, {});
  const linkedIdeaPills = (Object.entries(linkedTypeCounts) as [Moment["type"], number][])
    .map(([t, n]) => {
      const label = MOMENT_TYPE_LABELS[t].toUpperCase();
      return n > 1 ? `${n} ${label}S` : `${n} ${label}`;
    });

  function toggleLinkIdea(momentId: string) {
    if (linkedIds.includes(momentId)) {
      onUpdate({ momentIds: linkedIds.filter(id => id !== momentId) });
    } else {
      onUpdate({ momentIds: [...linkedIds, momentId] });
    }
  }

  function toggleCharacter(id: string) {
    const next = selectedCharIds.includes(id)
      ? selectedCharIds.filter(x => x !== id)
      : [...selectedCharIds, id];
    onUpdate({ characterIds: next });
  }

  // AI wand on the Description field. Two modes:
  //   - If the user typed something, route to `clean_beat` — tightens up
  //     freeform notes into a clean name + summary.
  //   - If the field is empty, route to `generate_beat` — invents a fresh
  //     scene from project context. Uses the beat's per-scene Weirdness
  //     dial when set, neutral defaults otherwise.
  // Both actions return the same { name, summary } shape so the patch
  // path downstream is identical.
  async function cleanUp() {
    if (cleaning) return;
    setCleaning(true);
    try {
      const action = beat.summary.trim()
        ? { type: "clean_beat" as const, payload: { rawText: beat.summary } }
        : {
            type: "generate_beat" as const,
            payload: {
              weirdness: beat.weirdness ?? 5,
              darkness: 5,
              humor: 3,
              length: 5,
            },
          };
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, action, profile }),
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
      const match = full.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          const patch: Partial<Beat> = {};
          if (parsed.name) patch.name = parsed.name;
          if (parsed.summary) patch.summary = parsed.summary;
          if (Object.keys(patch).length) onUpdate(patch);
        } catch {}
      }
    } finally {
      setCleaning(false);
    }
  }

  // Bump browseIdeaType to the first type-with-ideas the first time
  // the user opens the Linked-Idea row, so the lower picker isn't
  // empty-on-paint.
  useEffect(() => {
    if (openAttr === "idea" && browseIdeaType === null && ideaTypesWithIdeas.length > 0) {
      setBrowseIdeaType(ideaTypesWithIdeas[0]);
    }
  }, [openAttr, browseIdeaType, ideaTypesWithIdeas]);

  const ideasOfBrowseType = browseIdeaType
    ? moments.filter(m => m.type === browseIdeaType)
    : [];

  const twistVal = beat.twist ?? 0;
  const weirdnessVal = beat.weirdness ?? 0;

  return (
    <div>
      {/* Scene image — preview + (Re)generate. v2 only; v1 doesn't
          surface scene thumbnails so there's nothing to manage there.
          Only shown on the EDIT sheet (`!isNew`). The CREATE sheet
          stays clean — the auto-fill effect produces the first image
          on its own once a name lands and the sheet closes. */}
      {isV2Form && !isNew && (
        <div className="v2-scene-form-image">
          {/* In-flight FIRST — manual Regenerate (imgBusy) and bulk
              auto-gen (autoGenInFlight) both show shimmer. */}
          {(imgBusy || autoGenInFlight)
            ? <div className="v2-scene-form-image-img ds-image-shimmer is-dark" aria-label="Generating scene image" />
            : beat.thumbnail
              ? <img src={beat.thumbnail} alt="" className="v2-scene-form-image-img" />
              : <div className="v2-scene-form-image-img v2-scene-form-image-placeholder" aria-hidden="true" />}
          <Button
            variant="secondary"
            size="sm"
            onClick={generateSceneImage}
            disabled={imgBusy || !beat.name?.trim()}
            icon={<img src="/icon-ai-button.svg" alt="" aria-hidden="true" />}
          >
            {imgBusy ? "Generating…" : beat.thumbnail ? "Regenerate" : "Generate"}
          </Button>
        </div>
      )}

      {/* Scene name — `inline` keeps the input on the same row as
          the label rather than dropping below it. */}
      <TextAttrRow
        label="Scene name"
        value={beat.name}
        placeholder="Add a scene name"
        onChange={v => onUpdate({ name: v })}
        inline
      />

      {/* Location + Time of Day — the two halves of the slugline.
          Free text. `formatSlugline` (lib/story.ts) combines them
          at display time, applying an "INT." prefix when the
          location string doesn't already start with INT/EXT. The
          beat card's desktop heading row reads them via the helper. */}
      <TextAttrRow
        label="Location"
        value={beat.location ?? ""}
        placeholder='e.g. "Apartment" or "INT. Office"'
        onChange={v => onUpdate({ location: v })}
        inline
      />
      <TextAttrRow
        label="Time of day"
        value={beat.timeOfDay ?? ""}
        placeholder='e.g. "Night", "Day", "Sunset"'
        onChange={v => onUpdate({ timeOfDay: v })}
        inline
      />

      {/* Scene length (minutes). Stored on Beat.lengthMinutes as a
          positive finite number. Empty / non-numeric input clears
          the field (undefined), at which point the card's duration
          chip falls back to estimating from sceneContent words. */}
      <TextAttrRow
        label="Length (min)"
        value={beat.lengthMinutes != null ? String(beat.lengthMinutes) : ""}
        placeholder='e.g. "3" or "1.5"'
        onChange={v => {
          const trimmed = v.trim();
          if (!trimmed) {
            onUpdate({ lengthMinutes: undefined });
            return;
          }
          const n = parseFloat(trimmed);
          if (Number.isFinite(n) && n > 0) {
            onUpdate({ lengthMinutes: n });
          } else {
            // Invalid numeric — leave existing value alone. (User
            // gets the offending text echoed by the controlled input
            // but no patch is dispatched.)
            onUpdate({ lengthMinutes: undefined });
          }
        }}
        inline
      />

      {/* Linked idea — two-stage picker. Header pills summarize what's
          already linked by type. Body lists currently-linked ideas
          (with × to unlink), then a type chip row filtered to types
          that actually have saved ideas, then the ideas of the
          selected type as cards (tap toggles link). */}
      <AttrRow
        label="Link an idea"
        values={linkedIdeaPills.length > 0 ? linkedIdeaPills : undefined}
        placeholder={moments.length === 0 ? "No saved ideas yet" : "Pick from your ideas"}
        expanded={openAttr === "idea"}
        onToggle={() => toggleAttr("idea")}
      >
        {moments.length === 0 ? (
          <div className="caption">
            No ideas saved yet. Add some on the Ideas tab.
          </div>
        ) : (
          <>
            {linkedMoments.length > 0 && (
              <div className="beat-moments" style={{ marginBottom: 12 }}>
                {linkedMoments.map(m => (
                  <div key={m.id} className="linked-moment">
                    <div className="moment-type-dot" />
                    <div className="moment-preview">{m.text}</div>
                    <button
                      className="btn-icon"
                      style={{ width: 28, height: 28, fontSize: 14 }}
                      onClick={() => toggleLinkIdea(m.id)}
                      aria-label="Unlink"
                    >&#10005;</button>
                  </div>
                ))}
              </div>
            )}

            <div className="eyebrow" style={{ marginBottom: 8 }}>Type</div>
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {ideaTypesWithIdeas.map(t => (
                <Selector
                  key={t}
                  selected={browseIdeaType === t}
                  onClick={() => setBrowseIdeaType(t)}
                >
                  {MOMENT_TYPE_LABELS[t]}
                </Selector>
              ))}
            </div>

            {browseIdeaType && (
              <>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  {MOMENT_TYPE_LABELS[browseIdeaType]}s · {ideasOfBrowseType.length}
                </div>
                <div>
                  {ideasOfBrowseType.map(m => {
                    const isLinked = linkedIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`moment-picker-item ${isLinked ? "linked" : ""}`}
                        onClick={() => toggleLinkIdea(m.id)}
                        style={{ width: "100%", textAlign: "left" }}
                      >
                        <div style={{ flex: 1 }}>
                          <div className="mp-text">{m.text}</div>
                          {m.tags.length > 0 && (
                            <div className="mp-tags">{m.tags.map(t => <span key={t}>{t}</span>)}</div>
                          )}
                        </div>
                        {isLinked && <div className="mp-linked-badge">Linked</div>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </AttrRow>

      {/* Description (summary) — multiline, with Clean-up AI pinned next
          to the label via the TextAttrRow `ai` slot. */}
      <TextAttrRow
        label="Description"
        value={beat.summary}
        placeholder="Describe what happens in this scene"
        onChange={v => onUpdate({ summary: v })}
        multiline
        ai={cleanUp}
        aiLoading={cleaning}
      />

      {/* Characters in this scene */}
      <AttrRow
        label="Characters"
        values={selectedCharNames.length > 0 ? selectedCharNames.map(n => n.toUpperCase()) : undefined}
        placeholder={availableCharacters.length === 0 ? "No characters yet" : "Pick characters"}
        expanded={openAttr === "characters"}
        onToggle={() => toggleAttr("characters")}
      >
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
      </AttrRow>

      {/* Twist — per-scene "how surprising should the turn be" dial.
          Stored on Beat.twist (1-10 or undefined). Pill shows the
          current value when set; expand to access the slider. */}
      <AttrRow
        label="Twist"
        values={twistVal ? [`${twistVal}/10`] : undefined}
        placeholder="How surprising"
        expanded={openAttr === "twist"}
        onToggle={() => toggleAttr("twist")}
      >
        <div className="slider-row">
          <div className="label">{twistVal ? "Set" : "Off"}</div>
          <div className="value">{twistVal ? `${twistVal}/10` : "—"}</div>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          value={twistVal}
          onChange={e => {
            const v = Number(e.target.value);
            onUpdate({ twist: v === 0 ? undefined : v });
          }}
        />
      </AttrRow>

      {/* Weirdness — per-scene tone/imagery dial. Same shape as Twist. */}
      <AttrRow
        label="Weirdness"
        values={weirdnessVal ? [`${weirdnessVal}/10`] : undefined}
        placeholder="How strange"
        expanded={openAttr === "weirdness"}
        onToggle={() => toggleAttr("weirdness")}
      >
        <div className="slider-row">
          <div className="label">{weirdnessVal ? "Set" : "Off"}</div>
          <div className="value">{weirdnessVal ? `${weirdnessVal}/10` : "—"}</div>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          value={weirdnessVal}
          onChange={e => {
            const v = Number(e.target.value);
            onUpdate({ weirdness: v === 0 ? undefined : v });
          }}
        />
      </AttrRow>

      {/* Delete sits at the very bottom — same treatment as
          CharacterEditForm. Hidden in "New scene" mode: a not-yet-
          committed scene auto-discards on close, so there's nothing
          to delete. */}
      {!isNew && (
        <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
          <Button
            variant="secondary"
            size="sm"
            style={{ color: "var(--ink-mute)" }}
            onClick={onRemove}
          >
            Delete scene
          </Button>
        </div>
      )}
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
  onRegenerateThumbnail,
  isThumbnailInFlight = false,
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
  /** Lifted thumbnail regen — page.tsx flips thumbsInFlight, fetches
   *  the API, persists. Same path the home project cards subscribe
   *  to, so both surfaces shimmer in sync. */
  onRegenerateThumbnail?: (extra: string) => Promise<void>;
  /** Mirrors thumbsInFlight.has(story.id) from page.tsx. Drives the
   *  cover-image shimmer overlay + the Regenerate button's busy state. */
  isThumbnailInFlight?: boolean;
}) {
  const [uploadingCover, setUploadingCover] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  async function generateCover() {
    // Delegates to the lifted page-level handler so the in-flight
    // Set is the single source of truth for shimmer everywhere.
    if (!onRegenerateThumbnail) return;
    await onRegenerateThumbnail(story.thumbnailPromptExtra || "");
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
      <div className="display ds-type-tab-header settings-tab-heading" style={{ marginBottom: 18 }}>Settings</div>

      <div className="card">
        <span className="eyebrow">Cover</span>
        {/* When regenerating, replace the cover image with a shimmer
            block of the same dimensions. If the API fails, the next
            render flips back to the original thumbnail because we
            never clear story.thumbnail. */}
        {isThumbnailInFlight ? (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <div
              className="ds-image-shimmer is-dark"
              aria-label="Generating project image"
              style={{
                width: "100%",
                maxWidth: 320,
                aspectRatio: "16 / 9",
                borderRadius: 13,
                display: "block",
              }}
            />
          </div>
        ) : story.thumbnail && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <img
              src={story.thumbnail}
              alt=""
              style={{
                width: "100%",
                maxWidth: 320,
                aspectRatio: "16 / 9",
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
            disabled={isThumbnailInFlight || uploadingCover}
            icon={
              <svg viewBox="0 0 100 110" fill="currentColor" aria-hidden="true">
                <path d="m41.785 60.52h-13.055c-0.52344-0.0078-1.0547-0.14844-1.5352-0.43359-1.4141-0.84766-1.8789-2.6836-1.0273-4.1016l31.906-53.211c0.60547-1.0117 1.7852-1.6094 3.0195-1.4141 1.6289 0.25391 2.7461 1.7773 2.4961 3.4102l-5.375 34.715h13.055c0.52344 0.0078 1.0547 0.14844 1.5352 0.43359 1.4141 0.84766 1.8789 2.6836 1.0273 4.1016l-31.906 53.211c-0.60547 1.0117-1.7852 1.6094-3.0195 1.4141-1.6289-0.25391-2.7461-1.7773-2.4961-3.4102z" />
              </svg>
            }
          >
            {isThumbnailInFlight ? "Generating..." : "Regenerate"}
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
          disabled={isThumbnailInFlight || uploadingCover}
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
