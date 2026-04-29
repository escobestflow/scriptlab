"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Story, LayerKey, getActiveConceptDraft, getActiveCharactersDraft, getActiveStoryLayerDraft, getActiveScriptDraft, updateConceptDraft } from "@/lib/story";
import { Moment } from "@/lib/sampleData";
import { runEasyMode, type EasyModeStep, EasyModeError } from "@/lib/easyMode";
import {
  runScriptGenerationLoop,
  pendingBeatIds,
  prepareRewriteNewDraft,
} from "@/lib/scriptLoop";
import { EasyModeOverlay } from "@/components/EasyModeOverlay";
import {
  loadProjectsFromDB, saveProjectToDB, deleteProjectFromDB, newBlankProject,
  loadMomentsFromDB, saveMomentToDB, deleteMomentFromDB,
  loadPartnerProjectData,
} from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import {
  listMyPendingInvites,
  acceptInvite,
  declineInvite,
  getPartnerEmail,
  getProjectMembers,
  type PendingInvite,
  type ProjectMembers,
} from "@/lib/invites";
import { useAuth } from "@/lib/auth";
import { Studio } from "@/components/Studio";
import SplashLoader from "@/components/SplashLoader";
import PostLoginTransition from "@/components/PostLoginTransition";
import { useWriterProfile, WriterProfileContext, useProfileCapture } from "@/lib/writerProfileStore";
import type { WriterProfile } from "@/lib/writerProfile";
import { Genre, ProjectType } from "@/lib/story";
import { useAutosavePref, useDarkModePref, useDraftPickerStylePref } from "@/lib/prefs";
import { Button, Input, Textarea, Selector, Tip } from "@/components/ui";

type View =
  | { kind: "main" }
  | { kind: "studio"; projectId: string; isNew?: boolean; isFirstProject?: boolean; initialSection?: LayerKey };

// localStorage key that gates the first-project onboarding sheet. Set once
// the user dismisses the sheet; absence of this flag means "show welcome
// the next time a new project is created". We intentionally don't tie this
// to `projects.length === 0`: a user who deletes all projects and makes a
// new one isn't a first-timer, so the flag is sticky across sessions.
const ONBOARDING_FLAG_KEY = "unfold:first-project-onboarded";
function hasSeenFirstProjectOnboarding(): boolean {
  if (typeof window === "undefined") return true; // SSR: don't trigger
  try {
    return window.localStorage.getItem(ONBOARDING_FLAG_KEY) === "1";
  } catch {
    return true; // storage blocked → treat as seen so we don't nag
  }
}
function markFirstProjectOnboardingSeen() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_FLAG_KEY, "1");
  } catch { /* ignore */ }
}

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
  const [darkMode, setDarkMode] = useDarkModePref();
  // Draft-picker style pref — "sheet" (default) uses the portaled
  // bottom-sheet for both project-drafts and layer-drafts dropdowns.
  // "popup" uses the legacy inline-popup treatment for both. The
  // toggle below (in the main nav menu) flips between the two and
  // writes through useDraftPickerStylePref, whose write dispatches
  // a custom event so every live hook instance — including Studio's
  // and every LayerDraftPicker's — syncs immediately. Without that
  // cross-instance sync, flipping here wouldn't reach the consumers.
  const [draftPickerStyle, setDraftPickerStyle] = useDraftPickerStylePref();
  const useDraftPopup = draftPickerStyle === "popup";
  const [recording, setRecording] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Post-login transition completion gate. We keep the cinematic
  // transition mounted while projects are still loading OR while the
  // transition's internal timeline is still running, whichever finishes
  // last. That way a fast hydration doesn't cut the animation short,
  // and a slow one doesn't land us on the gray bridge screen.
  const [postLoginDone, setPostLoginDone] = useState(false);
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
  // Mount gate for the splash. SSR can't read sessionStorage, so
  // splashDone is always `false` on the server and the SSR'd HTML
  // includes a <SplashLoader>. That DOM is painted before the
  // component's `<style jsx global>` rules apply, so for one frame the
  // Unfold wordmark + Google icon SVGs fall back to their default
  // 300x150 box on the body's light bg → the "giant logos on white"
  // flash. Gating the splash branch on `mounted` keeps SSR output
  // neutral (just the .app shell, which picks up the theme bg via CSS);
  // after hydration the real state from sessionStorage takes over and
  // the splash plays normally for first-time visitors / signed-out
  // sessions.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // New project creation modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [createDraft, setCreateDraft] = useState<Story | null>(null);
  // Track whether the user has actively chosen a format. newBlankProject()
  // defaults projectType to "feature" so state is valid from the start,
  // but visually we treat Format as "unselected" until the user taps a
  // choice — which is what gates the Step 0 Continue button.
  const [createFormatTouched, setCreateFormatTouched] = useState(false);
  // Step 3 (Finish) "how do you want to start" selection. Null means no
  // option chosen yet — gates the Finish button. "easy" runs the AI
  // pipeline; "just" creates an empty project as before.
  const [easyModeChoice, setEasyModeChoice] = useState<"easy" | "just" | null>(null);
  // Easy-mode pipeline state. easyModeRunning gates the fullscreen
  // overlay; easyModeStep tracks which row's mini-spinner is animating;
  // easyModeError flips the overlay into the failure card; the projectId
  // ref keeps the seed reachable for Retry / Open project anyway.
  const [easyModeRunning, setEasyModeRunning] = useState(false);
  const [easyModeStep, setEasyModeStep] = useState<EasyModeStep | null>(null);
  const [easyModeError, setEasyModeError] = useState<{ step: EasyModeStep; message: string } | null>(null);
  const [easyModeProjectId, setEasyModeProjectId] = useState<string | null>(null);
  // Background script-generation job. Easy mode hands off to this after
  // scene 1 lands so the user can read scene 1 in the Script tab while
  // scenes 2..N stream in. `inflightBeatId` is the beat currently being
  // written; `pendingBeatIds` are beats queued behind it. Studio reads
  // both to render spinner cards. null when no loop is running. Only
  // one job at a time — Easy mode is gated on creation, and Studio's
  // "Write all scenes with AI" button is disabled while this is set.
  const [bgScriptJob, setBgScriptJob] = useState<{
    projectId: string;
    inflightBeatId: string | null;
    pendingBeatIds: Set<string>;
  } | null>(null);
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

  // Pending collaboration invites addressed to this user's email.
  // Rendered on the dashboard above the project list with Accept /
  // Decline buttons. Nothing shows for single-user accounts with no
  // invites — the section is fully hidden when the list is empty.
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const reloadPendingInvites = useCallback(async () => {
    if (!user) { setPendingInvites([]); return; }
    const list = await listMyPendingInvites();
    setPendingInvites(list);
  }, [user]);
  useEffect(() => { reloadPendingInvites(); }, [reloadPendingInvites]);

  // (handleAcceptInvite / handleDeclineInvite defined below, AFTER the
  // refresh* callbacks they depend on — we fan those caches out
  // in parallel at accept time so the card/Studio render complete.)

  // ── Phase 2 collab: partner-side story hydration ──────────────────
  // For any project where my row carries a collaboratorUserId, we
  // separately load the partner's own row (their distinct Story,
  // identified by the same projectId but a different user_id). The
  // partner's Story powers the second "Partner's drafts" dropdown that
  // appears next to the user's picker on every layer bar inside Studio.
  //
  // Keyed by projectId so entering/leaving Studio is fast on projects
  // we've already warmed. Stale entries are harmless — we refresh on
  // every Studio entry and on realtime notifications below.
  const [partnerStories, setPartnerStories] = useState<Record<string, Story>>({});
  // Partner email, per project — drives the initials chip rendered on
  // every partner-side draft picker. Resolved via the
  // get_partner_email SECURITY DEFINER RPC because auth.users is not
  // directly queryable from the client.
  const [partnerEmails, setPartnerEmails] = useState<Record<string, string>>({});
  // Full creator/invitee pair for the overlapping-initials indicator.
  // Drawn from project_invites so ordering is stable (creator on left,
  // invitee on right) and the invitee slot has an email to render even
  // before they've accepted — no more "?" fallbacks.
  const [projectMembers, setProjectMembers] = useState<Record<string, ProjectMembers>>({});

  // "Empty invitee seed" detection — used to decide whether to
  // backfill from the creator's row. Legacy rows created by the old
  // accept_invite (pre-collab-accept-seed-full.sql) had no logline,
  // no characters, no beats, no scenes. We treat that shape as a
  // candidate for one-time backfill. Any edit the invitee has
  // already made (even a single character, beat, or scene) causes
  // this to return false and we leave their row alone.
  const isEmptyInviteeSeed = (s: Story): boolean => {
    const c = getActiveConceptDraft(s);
    const ch = getActiveCharactersDraft(s);
    const st = getActiveStoryLayerDraft(s);
    const sc = getActiveScriptDraft(s);
    const hasLogline = !!c.logline?.trim();
    const hasCharacters = ch.characters.length > 0;
    const hasBeats = st.beats.length > 0 ||
      (st.episodes?.some(e => e.beats.length > 0) ?? false);
    const hasScenes = sc.script.scenes.length > 0;
    return !hasLogline && !hasCharacters && !hasBeats && !hasScenes;
  };

  const refreshPartnerStory = useCallback(async (projectId: string, partnerUserId: string) => {
    const partner = await loadPartnerProjectData(projectId, partnerUserId);
    if (!partner) return;
    setPartnerStories(prev => ({ ...prev, [projectId]: partner }));
  }, []);

  const refreshPartnerEmail = useCallback(async (projectId: string) => {
    const email = await getPartnerEmail(projectId);
    if (!email) return;
    setPartnerEmails(prev => ({ ...prev, [projectId]: email }));
  }, []);

  const refreshProjectMembers = useCallback(async (projectId: string) => {
    const members = await getProjectMembers(projectId);
    if (!members) return;
    setProjectMembers(prev => ({ ...prev, [projectId]: members }));
  }, []);

  const handleAcceptInvite = useCallback(async (token: string) => {
    if (!user) return;
    const res = await acceptInvite(token, user.id);
    if (typeof res === "string") {
      alert(
        res === "email-mismatch"
          ? "This invite was sent to a different email."
          : res === "project-full"
          ? "This project already has a collaborator."
          : res === "already-used"
          ? "This invite has already been used."
          : "Couldn't accept the invite. Please try again."
      );
      return;
    }
    // Eagerly warm every cache the card and Studio need so the project
    // renders complete (both circles + creator's logline/thumbnail)
    // the instant the projects list updates. Without this the user
    // sees a half-populated card — one initial, "no logline" — while
    // the dashboard-hydration useEffect sequentially dispatches these
    // RPCs after the projects state change. We already have the
    // projectId + creatorUserId directly from the RPC result, so we
    // can fire all three in parallel before even reloading the list.
    const { projectId, creatorUserId } = res;
    void refreshPartnerStory(projectId, creatorUserId);
    void refreshPartnerEmail(projectId);
    void refreshProjectMembers(projectId);
    // Reload both the project list (so the shared project appears)
    // and the pending-invites list (so the card goes away).
    const fresh = await loadProjectsFromDB(user.id);
    setProjects(fresh);
    await reloadPendingInvites();
  }, [
    user,
    reloadPendingInvites,
    refreshPartnerStory,
    refreshPartnerEmail,
    refreshProjectMembers,
  ]);

  const handleDeclineInvite = useCallback(async (token: string) => {
    if (!confirm("Decline this invite?")) return;
    const ok = await declineInvite(token);
    if (!ok) { alert("Couldn't decline the invite. Please try again."); return; }
    await reloadPendingInvites();
  }, [reloadPendingInvites]);

  // When entering a studio view for a shared project, hydrate partner
  // data immediately. Also subscribe to realtime changes on the partner's
  // row so we reflect their saves without a full reload. Channel is torn
  // down on project-switch or when the studio closes.
  const studioProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const v = view;
    if (v.kind !== "studio") { studioProjectIdRef.current = null; return; }
    const proj = projects.find(p => p.id === v.projectId);
    if (!proj || !proj.collaboratorUserId) {
      studioProjectIdRef.current = v.projectId;
      return;
    }
    studioProjectIdRef.current = v.projectId;
    const partnerId = proj.collaboratorUserId;
    // Initial load (and re-load on re-entry so we see any offline edits).
    refreshPartnerStory(v.projectId, partnerId);
    // Fetch the partner's email once per studio entry so the initial
    // chip has something to render. Cheap, idempotent, and cached.
    if (!partnerEmails[v.projectId]) {
      refreshPartnerEmail(v.projectId);
    }
    // Fetch the creator/invitee pair for the stable collab-initials
    // indicator. Separate from partnerEmail because it resolves the
    // emails in a fixed order — we render creator left, invitee right,
    // regardless of which side the current viewer is.
    if (!projectMembers[v.projectId]) {
      refreshProjectMembers(v.projectId);
    }
    // Realtime: listen for any UPDATE/INSERT on the partner's row.
    // The `filter` narrows the stream server-side so we don't get every
    // projects row change. Supabase realtime's filter string uses
    // PostgREST-style syntax on the payload column names.
    const channel = supabase
      .channel(`partner-project-${v.projectId}-${partnerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "projects",
          filter: `id=eq.${v.projectId}`,
        },
        (payload: any) => {
          // Only refresh when the event is actually the partner's row.
          const row = payload.new ?? payload.old;
          if (row?.user_id === partnerId) {
            refreshPartnerStory(v.projectId, partnerId);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [view, projects, refreshPartnerStory, refreshPartnerEmail, refreshProjectMembers, partnerEmails, projectMembers]);

  // Hydrate projectMembers + partnerEmails for every shared project on
  // dashboard landing. These back the overlapping-initials chip in the
  // top-right of every collab card.
  //
  // We used to also fetch the *creator's Story* here (for the invitee's
  // card) — but that depended on loadPartnerProjectData, and the
  // invitee's logline would flicker out across dashboard re-entries /
  // page reloads whenever the cache got invalidated. The new accept_invite
  // RPC (collab-accept-seed-full.sql) seeds the invitee's own row with
  // the creator's full data payload at accept time, so the invitee's
  // local row already carries logline / thumbnail / drafts — no partner
  // fetch needed on the dashboard. Studio entry still fetches partnerStory
  // (below, in the studio-view effect) because the "Partner's drafts"
  // picker needs the partner's live content.
  // One-time backfill bookkeeping: per-project, we only want to try
  // filling an empty invitee seed once per app session. This ref
  // tracks which project ids we've already attempted — another
  // attempt on the same project would redundantly hit the DB.
  const inviteeSeedBackfilledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hydrated || !user) return;
    projects.forEach(p => {
      if (!p.collaboratorUserId) return;
      if (!projectMembers[p.id]) {
        refreshProjectMembers(p.id);
      }
      // Eagerly load the partner's email for every shared project so
      // the card-chip fallback path never has to render "?". The RPC
      // is cheap and idempotent — once cached, no-ops.
      if (!partnerEmails[p.id]) {
        refreshPartnerEmail(p.id);
      }

      // One-time invitee-seed backfill. Projects accepted BEFORE the
      // collab-accept-seed-full.sql migration have an empty invitee
      // row ({id,title,projectType}); post-migration new invitees get
      // the full clone at accept time. For the legacy rows, when we
      // know we're the invitee (projectMembers says so) and our local
      // row has no logline / characters / beats / scenes, we fetch
      // the creator's row and save it into ours. One shot per session.
      const members = projectMembers[p.id];
      if (
        members &&
        !inviteeSeedBackfilledRef.current.has(p.id) &&
        members.creator.userId !== user.id &&
        p.collaboratorUserId === members.creator.userId &&
        isEmptyInviteeSeed(p)
      ) {
        inviteeSeedBackfilledRef.current.add(p.id);
        (async () => {
          const partner = await loadPartnerProjectData(p.id, members.creator.userId);
          if (!partner) return;
          // Preserve my own reverse-pointer (collaboratorUserId = creator);
          // everything else comes from the creator. Save + hydrate local
          // state so the card updates without a reload.
          const merged: Story = {
            ...partner,
            collaboratorUserId: members.creator.userId,
          };
          await saveProjectToDB(user.id, merged);
          setProjects(prev =>
            prev.map(x => (x.id === p.id ? merged : x)),
          );
        })();
      }
    });
  }, [
    hydrated,
    user,
    projects,
    projectMembers,
    partnerEmails,
    refreshProjectMembers,
    refreshPartnerEmail,
  ]);

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
  // Suppress the splash during SSR / pre-hydration so the server
  // doesn't emit an unstyled SplashLoader DOM that flashes as giant
  // logos before React takes over. Render a neutral app shell instead;
  // the theme bg paints and the real splash decision runs after mount.
  if (!mounted) {
    return <div className="app" />;
  }
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

  // Replaces the old "Loading your projects…" gray bridge screen with a
  // cinematic handoff from the splash-end pose into the home topbar.
  //
  // Orchestration:
  //  - While NOT hydrated: render the overlay alone with `ready={false}`
  //    — it holds on the splash-end pose (tagline + centered wordmark on
  //    black) with no animation, so we never show a half-animated state
  //    against an empty page.
  //  - Once hydrated: fall through to the normal render, which paints
  //    the real home screen behind the overlay. The overlay at the
  //    bottom of the main return receives `ready={true}`, kicks off its
  //    shrink, and the home content is progressively revealed as the
  //    black bar collapses upward. A final 250ms opacity fade dissolves
  //    the overlay into the identically-posed real topbar.
  if (!hydrated) {
    return (
      <PostLoginTransition
        ready={false}
        onDone={() => setPostLoginDone(true)}
      />
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
    setEasyModeChoice(null);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setCreateDraft(null);
    setCreateStep(0);
    setCreateFormatTouched(false);
    setEasyModeChoice(null);
  }

  function finishCreate() {
    if (!createDraft) return;
    const saved = createDraft;
    setProjects(ps => [saved, ...ps]);
    if (user) saveProjectToDB(user.id, saved);
    closeCreateModal();
    const firstTime = !hasSeenFirstProjectOnboarding();
    setView({ kind: "studio", projectId: saved.id, isNew: true, isFirstProject: firstTime });
    generateThumbnail(saved.id, saved.title, getActiveConceptDraft(saved).logline, getActiveConceptDraft(saved).settings.genres);
  }

  // ── Easy mode: run the AI pipeline against the freshly created seed ──
  //
  // Pulled into its own function so the EasyModeOverlay's Retry button can
  // re-invoke the chain against an existing project (which already exists
  // because the seed is committed before the chain starts — see
  // finishCreateEasy below). Persist callback awaits both local state and
  // Supabase upsert so a crash mid-chain leaves recoverable state.
  async function runEasyModeWithSeed(seed: Story) {
    setEasyModeRunning(true);
    setEasyModeError(null);
    setEasyModeStep(null);
    try {
      const finished = await runEasyMode(seed, {
        onStep: (s) => setEasyModeStep(s),
        persist: async (next) => {
          setProjects(ps => ps.map(p => p.id === next.id ? next : p));
          if (user) await saveProjectToDB(user.id, next);
        },
      });
      // Success: navigate into the project on the Script tab so the
      // user lands on the final output. Thumbnail generation reads the
      // freshly populated logline + genres.
      setEasyModeRunning(false);
      setEasyModeStep(null);
      const firstTime = !hasSeenFirstProjectOnboarding();
      setView({
        kind: "studio",
        projectId: finished.id,
        isNew: true,
        isFirstProject: firstTime,
        initialSection: "script",
      });
      generateThumbnail(
        finished.id,
        finished.title,
        getActiveConceptDraft(finished).logline,
        getActiveConceptDraft(finished).settings.genres,
      );
      // Hand off to the background script-generation loop. runEasyMode
      // already wrote scene 1 (so the user has something to read on
      // the Script tab); this fire-and-forget loop drains the rest.
      // Persistence per iteration means a tab close mid-loop loses
      // only the in-flight scene; everything before it is durable.
      // The returned Promise is ignored — Easy mode doesn't gate any
      // UI on first-scene-done because scene 1 is already written.
      void startBackgroundScriptLoop(finished);
    } catch (e: any) {
      // EasyModeError carries the offending step + the partial story.
      // We leave easyModeRunning true so the overlay stays mounted in
      // its error state with Retry / Open project anyway buttons.
      const failedStep: EasyModeStep =
        e instanceof EasyModeError ? e.failedStep : "concept";
      const message =
        e instanceof Error ? e.message : String(e ?? "Unknown error");
      setEasyModeError({ step: failedStep, message });
    }
  }

  // Background script-generation loop. Two callers:
  //   1. Easy mode hand-off — fires this fire-and-forget after step 4
  //      writes scene 1, draining scenes 2..N while the user reads.
  //   2. Studio's "Write all scenes with AI" / "Rewrite all scenes
  //      with AI (New Draft)" button — awaits the returned Promise
  //      wrapped in Studio's scrim, so the scrim covers exactly
  //      scene 1 and closes when scene 1 lands.
  //
  // Lives at page.tsx scope (not Studio's) so the loop survives the
  // user navigating between Studio tabs or even back to the project
  // list — only a tab close kills it. Each scene's prose is persisted
  // to Supabase before the next iteration starts, so partial
  // completion survives a tab close mid-loop.
  //
  // `opts.rewriteNewDraft` engages the rewrite path: clone the active
  // story-layer + script-layer drafts and reset every beat to "design"
  // before running the loop. The original prose is preserved on the
  // older story-layer draft (accessible via the Story tab's draft
  // picker) so users can swap back to it if they prefer the previous
  // take. Without this flag, the loop overwrites the existing draft
  // in place — used by Easy mode's hand-off (no prior prose to lose).
  //
  // Returns a Promise that resolves when:
  //   - the FIRST onBeatDone fires (manual mode's scrim closes here), OR
  //   - the queue was empty to begin with (no work, resolve immediately), OR
  //   - the loop errors out (resolve so caller's scrim doesn't hang).
  // Resolution semantics are "first scene ready or terminal" — callers
  // who care about full-loop completion should observe bgScriptJob
  // clearing instead.
  function startBackgroundScriptLoop(
    story: Story,
    profile?: WriterProfile | null,
    opts?: { rewriteNewDraft?: boolean },
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      // Rewrite-new-draft path: clone the story + script layer drafts
      // and clear every beat's sceneContent before the loop runs.
      // We update React state (and fire-and-forget the DB save) so the
      // Script tab visually resets to "no prose yet" while the loop
      // begins; the per-scene persist callback below will save the
      // cumulative state (cleared draft + scene 1) on the first
      // iteration anyway, so this upfront save is mostly belt-and-
      // suspenders for the case where the user closes the tab between
      // clearing and the first scene landing.
      let starting = story;
      if (opts?.rewriteNewDraft) {
        starting = prepareRewriteNewDraft(starting);
        setProjects(ps => ps.map(p => p.id === starting.id ? starting : p));
        if (user) void saveProjectToDB(user.id, starting);
      }

      const initialPending = pendingBeatIds(starting);
      if (!initialPending.size) { resolve(); return; }
      setBgScriptJob({
        projectId: starting.id,
        inflightBeatId: null,
        pendingBeatIds: initialPending,
      });
      // Resolve once-only — onBeatDone fires per scene but we only want
      // to dismiss the scrim on the first one.
      let resolved = false;
      const resolveOnce = () => { if (!resolved) { resolved = true; resolve(); } };
      void runScriptGenerationLoop({
        initialStory: starting,
        profile,
        persist: async (next) => {
          setProjects(ps => ps.map(p => p.id === next.id ? next : p));
          if (user) await saveProjectToDB(user.id, next);
        },
        onBeatStart: (beatId) => {
          // Promote this beat from pending → inflight so the Script tab
          // swaps its spinner copy from "Queued…" to "Writing now…".
          setBgScriptJob(j => {
            if (!j) return j;
            const nextPending = new Set(j.pendingBeatIds);
            nextPending.delete(beatId);
            return { ...j, inflightBeatId: beatId, pendingBeatIds: nextPending };
          });
        },
        onBeatDone: (beatId, _index, isFirstDone) => {
          // Clear inflight; the next iteration's onBeatStart will fill
          // it with the next beat. If this was the last beat, onComplete
          // fires next and clears the whole job.
          setBgScriptJob(j => j && j.inflightBeatId === beatId
            ? { ...j, inflightBeatId: null }
            : j,
          );
          if (isFirstDone) resolveOnce();
        },
        onComplete: () => { setBgScriptJob(null); resolveOnce(); },
        onError: (err) => {
          // Surface to console for now; completed scenes are persisted
          // and the user can resume manually via the per-scene "Write
          // this scene with AI" button.
          console.error("[bg script loop]", err);
          setBgScriptJob(null);
          resolveOnce();
        },
      });
    });
  }

  async function finishCreateEasy() {
    if (!createDraft) return;
    const seed = createDraft;
    // Commit the empty seed FIRST so the project shows up in the user's
    // list immediately and a crash mid-AI-run doesn't leave nothing.
    setProjects(ps => [seed, ...ps]);
    setEasyModeProjectId(seed.id);
    if (user) {
      try { await saveProjectToDB(user.id, seed); } catch { /* persist below */ }
    }
    closeCreateModal();
    await runEasyModeWithSeed(seed);
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
          isFirstProject={(view as any).isFirstProject ?? false}
          initialSection={(view as any).initialSection}
          onOnboardingSeen={markFirstProjectOnboardingSeen}
          onCreateProjectFromDraft={(newStory) => {
            setProjects(ps => [newStory, ...ps]);
            if (user) saveProjectToDB(user.id, newStory);
            const firstTime = !hasSeenFirstProjectOnboarding();
            setView({ kind: "studio", projectId: newStory.id, isNew: true, isFirstProject: firstTime });
          }}
          onDeleteProject={() => {
            const id = studioProject.id;
            setProjects(ps => ps.filter(p => p.id !== id));
            // Pass user.id so we delete only THIS user's row. On
            // shared projects the partner's copy is untouched.
            if (user) deleteProjectFromDB(id, user.id);
            else deleteProjectFromDB(id);
            setView({ kind: "main" });
          }}
          autosaveEnabled={autosaveEnabled}
          onEmailProject={() => openEmailSheet(studioProject)}
          emailProjectBusy={emailBusy}
          partnerStory={
            studioProject.collaboratorUserId
              ? partnerStories[studioProject.id]
              : undefined
          }
          partnerEmail={
            studioProject.collaboratorUserId
              ? partnerEmails[studioProject.id]
              : undefined
          }
          projectMembers={
            studioProject.collaboratorUserId
              ? projectMembers[studioProject.id]
              : undefined
          }
          bgScriptJob={
            bgScriptJob && bgScriptJob.projectId === studioProject.id
              ? {
                  inflightBeatId: bgScriptJob.inflightBeatId,
                  pendingBeatIds: bgScriptJob.pendingBeatIds,
                }
              : null
          }
          onStartBackgroundScriptLoop={startBackgroundScriptLoop}
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
                pendingInvites={pendingInvites}
                onAcceptInvite={handleAcceptInvite}
                onDeclineInvite={handleDeclineInvite}
                myUserId={user?.id ?? null}
                myEmail={user?.email ?? null}
                projectMembers={projectMembers}
                partnerEmails={partnerEmails}
              />
            )}
            {mainTab === "moments" && (
              <MomentsTab
                moments={moments}
                onEdit={(m) => setEditingMoment(m)}
                onDelete={(id) => deleteMoment(id)}
                onNew={() => {
                  setNewIdeaText("");
                  setNewIdeaType("scene");
                  setNewIdeaOpen(true);
                }}
                onStartRecording={startRecording}
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

          {/* Dark mode toggle — sits above Autosave in the utility stack.
              Same row pattern as Autosave. Writes through useDarkModePref,
              which flips <html data-theme> to engage globals.css overrides. */}
          <div
            className="menu-panel-utility"
            style={{ ["--d" as any]: "240ms" }}
            onClick={() => setDarkMode(!darkMode)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setDarkMode(!darkMode);
              }
            }}
          >
            <span className="label">Dark mode</span>
            <button
              type="button"
              className={`toggle-switch toggle-switch-dark ${darkMode ? "on" : ""}`}
              aria-label="Toggle dark mode"
              aria-pressed={darkMode}
              onClick={(e) => {
                e.stopPropagation();
                setDarkMode(!darkMode);
              }}
            >
              <span className="toggle-switch-knob" />
            </button>
          </div>

          {/* Draft popups — switches both the project-drafts and the
              layer-drafts picker between "popup" (inline dropdown
              below the trigger) and "sheet" (portaled bottom-sheet).
              ON = popup for both, OFF = sheet for both. Writes
              through useDraftPickerStylePref, which broadcasts a
              custom event on every write so every consumer of the
              hook (Studio + each LayerDraftPicker) syncs together. */}
          <div
            className="menu-panel-utility"
            style={{ ["--d" as any]: "245ms" }}
            onClick={() => setDraftPickerStyle(useDraftPopup ? "sheet" : "popup")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setDraftPickerStyle(useDraftPopup ? "sheet" : "popup");
              }
            }}
          >
            <span className="label">Draft popups</span>
            <button
              type="button"
              className={`toggle-switch toggle-switch-dark ${useDraftPopup ? "on" : ""}`}
              aria-label="Toggle draft popups"
              aria-pressed={useDraftPopup}
              onClick={(e) => {
                e.stopPropagation();
                setDraftPickerStyle(useDraftPopup ? "sheet" : "popup");
              }}
            >
              <span className="toggle-switch-knob" />
            </button>
          </div>

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
        </div>
        {/* Sticky footer — Save Idea always visible above the keyboard
            and any scrolled transcript content. The scrollable
            .sheet-body above flexes and caps at this footer's top. */}
        <div className="sheet-sticky-footer">
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
          <div className="create-stepper create-stepper-compact" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={createStep + 1}>
            {(["Format", "Title", "Genre", "Finish"] as const).map((name, i) => {
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
                  {i < 3 && <div className="create-step-track" aria-hidden="true" />}
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
          {createDraft && createStep === 3 && (
            <CreateStepHowToStart
              value={easyModeChoice}
              onChange={setEasyModeChoice}
            />
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
            <Button
              variant="primary"
              size="lg"
              // Steps 0–2 advance to the next step. Step 3 (Finish)
              // dispatches to the chosen creation path — Easy mode runs
              // the AI pipeline, Just create makes an empty project.
              onClick={() => {
                if (createStep < 3) { setCreateStep(s => s + 1); return; }
                if (easyModeChoice === "easy") finishCreateEasy();
                else if (easyModeChoice === "just") finishCreate();
              }}
              // Each step gates the primary action:
              //   step 0 Format: must be actively chosen
              //   step 1 Title:  must be non-empty
              //   step 2 Genre:  at least one genre selected
              //   step 3 Start:  one of Easy mode / Just create selected
              disabled={
                (createStep === 0 && !createFormatTouched) ||
                (createStep === 1 && !createDraft?.title?.trim()) ||
                (createStep === 2 && (createDraft ? getActiveConceptDraft(createDraft).settings.genres.length === 0 : true)) ||
                (createStep === 3 && !easyModeChoice)
              }
              style={{ flex: 1 }}
            >
              {createStep < 3 ? "Continue" : "Finish"}
            </Button>
          </div>
        </div>
      </div>

      {/* Easy-mode overlay — fullscreen scrim shown while the
          Concept→Characters→Story→Script chain is running, and on
          failure (with Retry / Open project anyway buttons). Mounted
          here at the app level rather than inside Studio because it
          has to be visible during project creation, before the user
          has navigated into Studio at all. */}
      {easyModeRunning && (
        <EasyModeOverlay
          currentStep={easyModeStep}
          error={easyModeError}
          onRetry={() => {
            // Re-run from the seed (which was committed before the
            // first run started). Prior partial writes get overwritten
            // by the new run's persist() calls.
            const seed = projects.find(p => p.id === easyModeProjectId);
            if (!seed) {
              setEasyModeRunning(false);
              setEasyModeError(null);
              return;
            }
            runEasyModeWithSeed(seed);
          }}
          onOpenAnyway={() => {
            // Hide the overlay and navigate the user into the partial
            // project. Land on the most-upstream layer that DID get
            // content before the failure — i.e. the layer just before
            // the failing step.
            setEasyModeRunning(false);
            const failed = easyModeError?.step ?? "concept";
            setEasyModeError(null);
            const partial = projects.find(p => p.id === easyModeProjectId);
            if (!partial) return;
            const landing: LayerKey =
              failed === "script"     ? "story"      :
              failed === "story"      ? "characters" :
              failed === "characters" ? "concept"    :
              "concept";
            const firstTime = !hasSeenFirstProjectOnboarding();
            setView({
              kind: "studio",
              projectId: partial.id,
              isNew: true,
              isFirstProject: firstTime,
              initialSection: landing,
            });
          }}
        />
      )}

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
    {/* Post-login transition overlay, rendered on top of the real app
        until the full fade → shrink → fade-out sequence completes. Its
        position:fixed + pointer-events:none lets the user see (but not
        yet touch) the content behind as the black bar collapses up. */}
    {!postLoginDone && (
      <PostLoginTransition
        ready={true}
        onDone={() => setPostLoginDone(true)}
      />
    )}
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
  pendingInvites, onAcceptInvite, onDeclineInvite,
  myUserId, myEmail, projectMembers, partnerEmails,
}: {
  projects: Story[];
  onOpen: (id: string) => void;
  onNew: () => void;
  pendingInvites: PendingInvite[];
  onAcceptInvite: (token: string) => void;
  onDeclineInvite: (token: string) => void;
  /** Current user's auth id — used to tell whether this user is the
   *  creator or invitee for each shared project. Null while the auth
   *  session is still hydrating. */
  myUserId: string | null;
  /** Current user's email — used as an ordering fallback for the
   *  initials chip when projectMembers hasn't resolved yet. */
  myEmail: string | null;
  /** Creator/invitee pair per project id, backed by the
   *  project_invites-joined RPC. Drives the overlapping-initials chip. */
  projectMembers: Record<string, ProjectMembers>;
  /** Partner's email per project id — used as the right-circle
   *  fallback in the card-chip when projectMembers hasn't resolved.
   *  Loaded eagerly on dashboard hydration so the chip always has a
   *  letter, never a "?". */
  partnerEmails: Record<string, string>;
}) {
  const hasInvites = pendingInvites.length > 0;

  // First-run empty state — only when there are also no pending
  // invites. A brand-new user whose first interaction is an invite
  // should land on that invite card, not on "Get started".
  if (projects.length === 0 && !hasInvites) {
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
      {hasInvites && (
        <div style={{ marginTop: 40, marginBottom: 20 }}>
          <div className="display" style={{ marginBottom: 14 }}>Invitations</div>
          {pendingInvites.map(inv => (
            <div
              key={inv.token}
              className="project-card"
              style={{
                textAlign: "left",
                cursor: "default",
                width: "100%",
                marginBottom: 12,
              }}
            >
              <div className="project-cover">
                {inv.projectThumbnail ? (
                  <img src={inv.projectThumbnail} alt="" className="project-cover-img" />
                ) : (
                  <span className="project-cover-initial">
                    {inv.projectTitle ? inv.projectTitle.charAt(0).toUpperCase() : "?"}
                  </span>
                )}
              </div>
              <div className="project-body">
                <div className="project-title">{inv.projectTitle || "Untitled"}</div>
                <div className="project-summary" style={{ marginBottom: 10 }}>
                  {inv.creatorEmail
                    ? `${inv.creatorEmail} invited you to collaborate`
                    : "You've been invited to collaborate"}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onAcceptInvite(inv.token)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onDeclineInvite(inv.token)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20, marginTop: hasInvites ? 10 : 40 }}>
        <div className="display">Projects</div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onNew}
          icon={<img src="/add-icon.svg" alt="" style={{ width: 9, height: 9 }} />}
          style={{ transform: "translateY(-7px)", background: "#fff" }}
        >
          New Project
        </Button>
      </div>

      {projects.length === 0 && (
        <div className="caption" style={{ opacity: 0.6, marginBottom: 20 }}>
          No projects yet. Tap New Project to start one.
        </div>
      )}

      {projects.map(p => {
        // Card renders straight from the user's own row. For the
        // invitee, accept_invite now seeds their row with a full
        // copy of the creator's data (logline, thumbnail, drafts, …)
        // at accept time — see supabase/collab-accept-seed-full.sql.
        // No partner-story fetch needed on the dashboard.
        const members = projectMembers[p.id];
        const isCollab = !!p.collaboratorUserId;
        const c = getActiveConceptDraft(p);

        // Initials chip on collab cards. Build each slot
        // independently, walking multiple sources so a missing RPC
        // (e.g. get_partner_email / get_project_members not yet
        // migrated) can't blank out the whole chip.
        //
        //   * Canonical data (members) gives stable creator-left /
        //     invitee-right ordering for both viewers.
        //   * Gaps in canonical are filled from viewer-local
        //     sources — myEmail for the viewer's side,
        //     partnerEmails[id] for the other.
        //   * With no canonical data we default to viewer-local
        //     ordering: me-left, partner-right. The viewer's own
        //     circle always resolves because myEmail comes from
        //     the auth session.
        const pickLetter = (
          name: string | null | undefined,
          email: string | null | undefined,
        ): string | null => {
          const n = (name ?? "").trim();
          if (n) return n.charAt(0).toUpperCase();
          const e = (email ?? "").trim();
          if (e) return e.charAt(0).toUpperCase();
          return null;
        };
        let leftEmail: string | null = null;
        let leftName: string | null = null;
        let rightEmail: string | null = null;
        let rightName: string | null = null;
        if (members?.creator || members?.invitee) {
          leftEmail = members?.creator?.email ?? null;
          leftName = members?.creator?.displayName ?? null;
          rightEmail = members?.invitee?.email ?? null;
          rightName = members?.invitee?.displayName ?? null;
          const iAmLeft =
            !!(members?.creator?.userId && myUserId &&
               members.creator.userId === myUserId);
          const iAmRight =
            !!(members?.invitee?.userId && myUserId &&
               members.invitee.userId === myUserId);
          if (!leftEmail) {
            if (iAmRight) leftEmail = partnerEmails[p.id] ?? null;
            else leftEmail = myEmail ?? null;
          }
          if (!rightEmail) {
            if (iAmLeft) rightEmail = partnerEmails[p.id] ?? null;
            else rightEmail = myEmail ?? null;
          }
        } else {
          // No canonical data — viewer-local ordering.
          leftEmail = myEmail ?? null;
          rightEmail = partnerEmails[p.id] ?? null;
        }
        const leftChar = pickLetter(leftName, leftEmail);
        const rightChar = pickLetter(rightName, rightEmail);

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
              </div>
              <div className="project-summary">{c.logline || "No logline yet"}</div>
            </div>
            {isCollab && (leftChar || rightChar) && (
              <span
                className="collab-initials-pair project-card-initials"
                aria-label="Collaborators"
              >
                {leftChar && <span className="collab-initial">{leftChar}</span>}
                {rightChar && <span className="collab-initial">{rightChar}</span>}
              </span>
            )}
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

/**
 * Swipe-to-delete wrapper for a single list item.
 *
 * The inner content translates left under the user's finger; a red
 * Delete panel sits behind it, revealed as the content moves away.
 * After the finger lifts, the row either snaps back to 0 (if the
 * user didn't drag past the threshold) or snaps open to fully reveal
 * the panel (if they did). Tapping the content while it's open snaps
 * it back — and the would-be tap is swallowed so the row doesn't
 * also fire its underlying onClick (i.e., no accidental edit-sheet
 * open while dismissing a swipe). Tapping the Delete panel calls
 * onDelete and unmounts the wrapper.
 *
 * Gesture axis-lock: on the first few pixels of movement we decide
 * whether the touch is primarily horizontal or vertical. Vertical
 * wins → we release and let the page scroll. Horizontal wins → we
 * hijack and drive the translation. This keeps the normal scroll
 * gesture intact on top of the swipe gesture.
 */
function SwipeToDelete({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const REVEAL = 88;       // width of the red Delete panel (keep in sync with CSS)
  const OPEN_THRESHOLD = 40; // px dragged past which we snap open instead of closed
  const [offset, setOffset] = useState(0);
  const [opened, setOpened] = useState(false);
  const [dragging, setDragging] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const startOffset = useRef(0);
  const axis = useRef<"none" | "x" | "y">("none");
  const moved = useRef(false);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    startOffset.current = offset;
    axis.current = "none";
    moved.current = false;
    setDragging(true);
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    // Axis-lock: the first ~6px of movement decides whether this
    // gesture is a swipe (horizontal) or a scroll (vertical).
    if (axis.current === "none") {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (axis.current === "y") {
          // Let the page scroll; we're out of this gesture.
          setDragging(false);
          return;
        }
      }
    }
    if (axis.current !== "x") return;
    if (Math.abs(dx) > 4) moved.current = true;
    // Clamp to [-REVEAL, 0] — only left-swipe is meaningful.
    const next = Math.max(-REVEAL, Math.min(0, startOffset.current + dx));
    setOffset(next);
  }
  function onTouchEnd() {
    if (!dragging) return;
    setDragging(false);
    if (offset < -OPEN_THRESHOLD) {
      setOffset(-REVEAL);
      setOpened(true);
    } else {
      setOffset(0);
      setOpened(false);
    }
  }

  // When the row is opened, tapping ANYWHERE outside it should snap
  // it closed. We attach the listener one tick late so the tap that
  // opened the row (which bubbled up by the time touchend fired)
  // doesn't immediately re-close it on the same event loop pass.
  useEffect(() => {
    if (!opened) return;
    const onDocClick = () => {
      setOffset(0);
      setOpened(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("click", onDocClick);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", onDocClick);
    };
  }, [opened]);

  return (
    <div
      className="swipe-card"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <button
        className="swipe-card-delete"
        onClick={(e) => {
          // Don't let this click bubble up to the content's onClick
          // (which would open the edit sheet) or the document
          // outside-click listener.
          e.stopPropagation();
          onDelete();
        }}
        type="button"
        aria-label="Delete"
      >
        Delete
      </button>
      <div
        className="swipe-card-content"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging
            ? "none"
            : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClickCapture={(e) => {
          // If the row has been opened or the user just swiped, the
          // inner card's onClick is NOT what they want — they want to
          // dismiss the swipe or interact with Delete. Swallow the
          // click in the capture phase so the child handler never
          // fires; snap closed.
          if (moved.current || opened) {
            e.preventDefault();
            e.stopPropagation();
            setOffset(0);
            setOpened(false);
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Ideas-tab empty-state hero carousel. Three 258×194 illustrations cycle
 * every 4s and on horizontal swipe; the last slide wraps around to the
 * first (and vice-versa). Three 6×6 dots under the frame indicate the
 * active slide (#3E3E3E active, #D9D9D9 idle) and also serve as tap
 * targets for direct navigation. Tap/swipe interaction resets the
 * auto-advance timer so the user doesn't feel the carousel "fighting"
 * them immediately after an input.
 */
const IDEAS_CAROUSEL_SRCS = [
  "/ideas-carousel-1.png",
  "/ideas-carousel-2.png",
  "/ideas-carousel-3.png",
];
/** Headings paired 1:1 with IDEAS_CAROUSEL_SRCS — shown above the frame
 *  and cross-faded whenever the active slide changes. */
const IDEAS_CAROUSEL_HEADINGS = [
  "Start with an idea",
  "Record it",
  "Put it in your script",
];
const IDEAS_CAROUSEL_MS = 4000;
const IDEAS_CAROUSEL_SWIPE_PX = 40;

function IdeasCarousel({
  onIndexChange,
}: {
  onIndexChange?: (i: number) => void;
}) {
  const [index, setIndex] = useState(0);
  // Broadcast index changes so the parent header can cross-fade in sync
  // with the active slide.
  useEffect(() => {
    onIndexChange?.(index);
  }, [index, onIndexChange]);
  // Touch tracking for swipe; we use refs rather than state so the
  // frequent touchmove events don't re-render the component.
  const touchStartX = useRef<number | null>(null);
  const touchDx = useRef(0);
  const [drag, setDrag] = useState(0); // live translate offset while dragging

  // Auto-advance. Re-created on every `index` change so a manual jump
  // gives the user a fresh 4s to look at their chosen slide.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setIndex((i) => (i + 1) % IDEAS_CAROUSEL_SRCS.length);
    }, IDEAS_CAROUSEL_MS);
    return () => window.clearTimeout(id);
  }, [index]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchDx.current = 0;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    touchDx.current = e.touches[0].clientX - touchStartX.current;
    setDrag(touchDx.current);
  }
  function onTouchEnd() {
    const dx = touchDx.current;
    touchStartX.current = null;
    touchDx.current = 0;
    setDrag(0);
    if (Math.abs(dx) < IDEAS_CAROUSEL_SWIPE_PX) return;
    // Swipe left (dx < 0) advances; swipe right (dx > 0) goes back.
    setIndex((i) => {
      const n = IDEAS_CAROUSEL_SRCS.length;
      return dx < 0 ? (i + 1) % n : (i - 1 + n) % n;
    });
  }

  return (
    <div className="ideas-carousel">
      <div
        className="ideas-carousel-viewport"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className="ideas-carousel-track"
          style={{
            transform: `translateX(calc(${-index * 100}% + ${drag}px))`,
            transition: drag === 0 ? "transform 380ms var(--ease)" : "none",
          }}
        >
          {IDEAS_CAROUSEL_SRCS.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              className="ideas-carousel-slide"
              draggable={false}
              aria-hidden={i !== index}
            />
          ))}
        </div>
      </div>
      <div className="ideas-carousel-dots" role="tablist">
        {IDEAS_CAROUSEL_SRCS.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Go to slide ${i + 1}`}
            className={`ideas-carousel-dot ${i === index ? "active" : ""}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Ideas tab first-run hero. Owns the active carousel index so the
 * heading above the frame can cross-fade to the string that matches
 * the current illustration. The body copy, CTA, and down-arrow stay
 * constant — only the title swaps with the image.
 */
function IdeasEmptyState({
  onStartRecording,
}: {
  onStartRecording: () => void;
}) {
  const [carouselIndex, setCarouselIndex] = useState(0);
  // Stable callback so IdeasCarousel's broadcast effect doesn't
  // re-fire on every parent render.
  const handleIndexChange = useCallback((i: number) => {
    setCarouselIndex(i);
  }, []);

  return (
    <div className="projects-empty ideas-empty">
      <IdeasCarousel onIndexChange={handleIndexChange} />
      {/* `key` forces a fresh mount on every slide change so the CSS
          fade-in animation re-runs; the outgoing element is dropped
          instantly, which reads as a clean swap rather than a
          cross-dissolve (simpler + cheaper). */}
      <h1
        key={carouselIndex}
        className="projects-empty-title ideas-empty-title"
      >
        {IDEAS_CAROUSEL_HEADINGS[carouselIndex]}
      </h1>
      <p className="projects-empty-sub">
        {/* Explicit line breaks guarantee the intended three-line
            layout regardless of viewport / font-metric drift:
              1. Record ideas, memories, dreams, conversations,
              2. or unforgettable moments and let AI turn them
              3. into scenes and stories. */}
        Record ideas, memories, dreams, conversations,<br />
        or unforgettable moments and let AI turn them<br />
        into scenes and stories.
      </p>
      <button
        type="button"
        className="projects-empty-cta-text"
        onClick={onStartRecording}
      >
        Start Recording
      </button>
      <img
        src="/down-arrow.svg"
        alt=""
        width={44}
        height={50}
        className="projects-empty-down-arrow"
      />
    </div>
  );
}

function MomentsTab({
  moments,
  onEdit,
  onDelete,
  onNew,
  onStartRecording,
}: {
  moments: Moment[];
  onEdit: (m: Moment) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onStartRecording: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("All");

  // Dev-only: "Convert all notes to AI prompt". When the Note filter is
  // active, a button above the list posts every filtered note to
  // /api/convert-notes, which polishes them into AI coding prompts
  // (app-edit shorthand the dev writes while using the app). Result
  // lands in a bottom sheet with a copy-to-clipboard button.
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertSheetOpen, setConvertSheetOpen] = useState(false);
  const [convertOutput, setConvertOutput] = useState("");
  const [convertCopied, setConvertCopied] = useState(false);

  const filtered = moments.filter(m => {
    if (filter !== "All" && m.type !== filter.toLowerCase()) return false;
    if (search && !m.text.toLowerCase().includes(search.toLowerCase()) &&
        !m.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  async function convertNotesToPrompts() {
    if (convertBusy) return;
    const notes = filtered.map(m => m.text).filter(t => t.trim() !== "");
    if (notes.length === 0) return;
    setConvertBusy(true);
    setConvertOutput("");
    setConvertSheetOpen(true);
    try {
      const res = await fetch("/api/convert-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const text = await res.text();
      if (!res.ok) {
        setConvertOutput(`Error: ${text}`);
      } else {
        setConvertOutput(text);
      }
    } catch (e: any) {
      setConvertOutput(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConvertBusy(false);
    }
  }

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

  // First-run empty state for Ideas. Mirrors the Projects-tab empty-state
  // pattern (same `.projects-empty` container, same title/sub typography)
  // so the two tabs feel like a matched pair. The CTA is a plain text
  // button (not a pill) styled with `.projects-empty-cta-text`, followed
  // by the down-arrow glyph pointing at the red record FAB below.
  if (moments.length === 0) {
    return <IdeasEmptyState onStartRecording={onStartRecording} />;
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
          style={{ transform: "translateY(-7px)", background: "#fff" }}
        >
          New Idea
        </Button>
      </div>

      <div className="search-bar">
        <IconSearch />
        <input
          placeholder="Search ideas"
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

      {/* Dev-only: Convert all notes to AI prompts. Shown only when the
          Notes filter is active AND there is at least one matching note. */}
      {filter === "Note" && filtered.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={convertNotesToPrompts}
            disabled={convertBusy}
          >
            {convertBusy
              ? "Converting…"
              : `Convert all notes to AI prompt (${filtered.length})`}
          </Button>
        </div>
      )}

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--ink-mute)", fontSize: 14 }}>
          {search || filter !== "All"
            ? "No ideas match your filter."
            : "Tap New Idea above, or the red record button below, to capture your first idea."}
        </div>
      )}

      {filtered.length > 0 && (
        <Tip id="ideas-swipe-delete">
          Swipe left on any idea to delete it.
        </Tip>
      )}

      {filtered.map(m => (
        <SwipeToDelete key={m.id} onDelete={() => onDelete(m.id)}>
          <div
            className="card moment-item"
            onClick={() => onEdit(m)}
            style={{ cursor: "pointer" }}
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
        </SwipeToDelete>
      ))}

      {/* Convert-notes output sheet — only mounted while open, so nothing
          lingers in the DOM at the bottom of the list when closed.
          Minimal chrome: scrollable output + Copy + Close. Closing
          clears convertOutput so re-tapping Convert re-fetches fresh. */}
      {convertSheetOpen && (
        <>
          <div
            className="sheet-backdrop open"
            onClick={() => {
              if (convertBusy) return;
              setConvertSheetOpen(false);
              setConvertOutput("");
            }}
          />
          <div className="sheet open">
            <div className="sheet-handle" />
            <div className="sheet-body" style={{ whiteSpace: "normal" }}>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: "var(--bg-subtle, #f6f6f6)",
                  borderRadius: 8,
                  padding: 12,
                  maxHeight: "50vh",
                  overflowY: "auto",
                  marginTop: 20,
                  marginBottom: 14,
                }}
              >
                {convertBusy && !convertOutput ? "…" : convertOutput}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={async () => {
                    if (!convertOutput) return;
                    try {
                      await navigator.clipboard.writeText(convertOutput);
                      setConvertCopied(true);
                      setTimeout(() => setConvertCopied(false), 1500);
                    } catch {
                      /* ignore — clipboard may be unavailable */
                    }
                  }}
                  disabled={!convertOutput || convertBusy}
                  style={{ flex: 1 }}
                >
                  {convertCopied ? "Copied!" : "Copy"}
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    setConvertSheetOpen(false);
                    setConvertOutput("");
                  }}
                  disabled={convertBusy}
                  style={{ flex: 1 }}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
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

// Step 4 of the create flow — "How do you want to start?". Renders
// two tappable .choice cards (matching the Format step's visual
// pattern) for "Use Easy mode" vs "Just create project". The picked
// value is owned by the parent so the footer's Finish button can gate
// on it and dispatch to the right finish handler on click.
function CreateStepHowToStart({
  value, onChange,
}: {
  value: "easy" | "just" | null;
  onChange: (v: "easy" | "just") => void;
}) {
  const options: Array<{
    key: "easy" | "just";
    title: string;
    sub: string;
  }> = [
    {
      key: "easy",
      title: "Use Easy mode",
      sub: "AI fills in your concept, characters, story beats, and a first-pass script from your title, format, and genre. Takes a couple of minutes; edit everything after.",
    },
    {
      key: "just",
      title: "Just create project",
      sub: "Start with empty drafts and build each layer yourself.",
    },
  ];
  return (
    <>
      <div className="display heading" style={{ marginTop: 25 }}>How do you want to start?</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 25 }}>
        {options.map(opt => (
          <button
            key={opt.key}
            className={`choice ${value === opt.key ? "selected" : ""}`}
            onClick={() => onChange(opt.key)}
            style={{ textAlign: "left" }}
          >
            <div className="choice-title">{opt.title}</div>
            <div className="choice-sub">{opt.sub}</div>
          </button>
        ))}
      </div>
    </>
  );
}
