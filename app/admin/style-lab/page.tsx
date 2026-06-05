"use client";

// Style Lab — admin-only prose-voice calibration.
// See docs/style-calibration.md. Generate short samples that vary
// across 6 taste dials grounded in the writer's references; pick 3;
// the picks move a learned vector (shown live on the sliders); Lock
// distills a rubric and freezes a StyleProfile that steers every
// script-prose generation.
//
// Cost: each round = 15 short Haiku samples (~$0.08). Distill = 1
// Sonnet call. Real writing stays on Opus, guided by the locked profile.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { DesktopSidebar, deriveSidebarUserFields } from "@/components/DesktopSidebar";
import { newBlankProject } from "@/lib/storage";
import { loadWriterProfileFromDB, saveWriterProfileToDB } from "@/lib/writerProfileStore";
import { emptyProfile } from "@/lib/writerProfile";
import { callGenerate, extractJson } from "@/lib/syncLayer";
import {
  STYLE_AXES, AXIS_KEYS, type AxisKey, type StyleCoord,
  seedCoord, sampleCoords, coordToDirective, coordSummary,
  updateVector, convergence, alphaForRound, spreadForRound,
  BASE_STYLE_DNA, type StyleProfile,
} from "@/lib/styleProfile";

const ROUND_SIZE = 15;
const PICK_TARGET = 3;
const CONCURRENCY = 6; // throttle parallel Haiku calls → far fewer rate-limit failures
const ACCENT = "#d8b66b"; // cinematic warm gold
const DEFAULT_BRIEF =
  "Two people, one room. One is hiding something the other has just started to suspect. Mid-conversation — no setup, drop us in.";

interface Candidate {
  coord: StyleCoord;
  lean: string;
  text: string;
  status: "loading" | "done" | "error";
}

// Run async work with bounded concurrency — prevents 15 simultaneous
// API calls from tripping rate limits (the old "some failed" cause).
async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export default function StyleLabPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin(user?.email)) router.replace("/");
  }, [authLoading, user?.email, router]);

  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [vector, setVector] = useState<StyleCoord>(() => seedCoord());
  const [spread, setSpread] = useState(0.3);
  const [round, setRound] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [generating, setGenerating] = useState(false);
  const [convHistory, setConvHistory] = useState<number[]>([]);
  const [locking, setLocking] = useState(false);
  const [lockedRubric, setLockedRubric] = useState<string | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);

  const synthStory = useMemo(() => newBlankProject(), []);
  const { userInitial, userAvatarUrl, userDisplayName } = deriveSidebarUserFields(user);

  // Keep a live ref to brief so per-card regenerate reads the latest.
  const briefRef = useRef(brief);
  useEffect(() => { briefRef.current = brief; }, [brief]);

  // Generate one sample for a coordinate, with one retry on failure.
  const genOne = useCallback(async (coord: StyleCoord, attempt = 0): Promise<string> => {
    try {
      const text = await callGenerate(
        synthStory,
        { type: "style_sample", payload: { brief: briefRef.current, directive: coordToDirective(coord), baseStyle: BASE_STYLE_DNA } },
        null,
      );
      if (!text.trim()) throw new Error("empty");
      return text.trim();
    } catch (e) {
      if (attempt < 1) return genOne(coord, attempt + 1);
      throw e;
    }
  }, [synthStory]);

  const runRound = useCallback(async (forVector: StyleCoord, forSpread: number, roundIdx: number) => {
    setGenerating(true);
    setSelected([]);
    setLockedRubric(null);
    setLockError(null);
    const coords = sampleCoords(ROUND_SIZE, forVector, [...AXIS_KEYS], forSpread, roundIdx);
    setCandidates(coords.map(coord => ({ coord, lean: coordSummary(coord), text: "", status: "loading" as const })));
    await mapPool(coords, CONCURRENCY, async (coord, i) => {
      try {
        const text = await genOne(coord);
        setCandidates(prev => { const n = [...prev]; if (n[i]) n[i] = { ...n[i], text, status: "done" }; return n; });
      } catch {
        setCandidates(prev => { const n = [...prev]; if (n[i]) n[i] = { ...n[i], text: "Generation failed — hit ↻ to retry.", status: "error" }; return n; });
      }
    });
    setGenerating(false);
  }, [genOne]);

  const regenerateOne = useCallback(async (i: number) => {
    const coord = candidates[i]?.coord;
    if (!coord) return;
    setCandidates(prev => { const n = [...prev]; if (n[i]) n[i] = { ...n[i], status: "loading", text: "" }; return n; });
    try {
      const text = await genOne(coord);
      setCandidates(prev => { const n = [...prev]; if (n[i]) n[i] = { ...n[i], text, status: "done" }; return n; });
    } catch {
      setCandidates(prev => { const n = [...prev]; if (n[i]) n[i] = { ...n[i], text: "Generation failed — hit ↻ to retry.", status: "error" }; return n; });
    }
  }, [candidates, genOne]);

  const startRound = (vec: StyleCoord, r: number) => {
    setRound(r);
    void runRound(vec, spread, r);
  };

  const restart = () => {
    const seed = seedCoord();
    setVector(seed);
    setConvHistory([]);
    startRound(seed, 1);
  };

  const toggleSelect = (i: number) => {
    if (candidates[i]?.status !== "done") return;
    setSelected(prev =>
      prev.includes(i) ? prev.filter(x => x !== i)
      : prev.length >= PICK_TARGET ? prev
      : [...prev, i],
    );
  };

  const pickedCoords = () => selected.map(i => candidates[i].coord);

  const nextRound = () => {
    const picks = pickedCoords();
    const conv = convergence(picks);
    const nextVec = updateVector(vector, picks, alphaForRound(conv));
    setVector(nextVec);            // sliders animate to the new learned position
    setSpread(spreadForRound(conv));
    setConvHistory(h => [...h, conv]);
    startRound(nextVec, round + 1);
  };

  const lockStyle = async () => {
    if (!user?.id) { setLockError("Not signed in."); return; }
    const picks = pickedCoords();
    if (picks.length === 0) return;
    setLocking(true);
    setLockError(null);
    try {
      const samples = selected.map(i => ({ text: candidates[i].text, lean: candidates[i].lean }));
      const raw = await callGenerate(synthStory, { type: "distill_style_rubric", payload: { samples } }, null);
      const parsed = extractJson(raw);
      const rubric: string = typeof parsed?.rubric === "string" && parsed.rubric.trim()
        ? parsed.rubric.trim() : samples.map(s => `- ${s.lean}`).join("\n");
      const conv = convergence(picks);
      const finalVec = updateVector(vector, picks, alphaForRound(conv));
      const existing = (await loadWriterProfileFromDB(user.id)) ?? emptyProfile();
      const styleProfile: StyleProfile = {
        version: (existing.styleProfile?.version ?? 0) + 1,
        status: "locked", scope: "global", axes: finalVec, rubric,
        exemplars: selected.slice(0, 4).map(i => ({ text: candidates[i].text, coord: candidates[i].coord })),
        lockedAt: new Date().toISOString(),
      };
      await saveWriterProfileToDB(user.id, { ...existing, styleProfile });
      setVector(finalVec);
      setLockedRubric(rubric);
    } catch (e: unknown) {
      setLockError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocking(false);
    }
  };

  const latestConv = convHistory.length ? convHistory[convHistory.length - 1] : 0;
  const canAdvance = selected.length === PICK_TARGET && !generating && !locking;

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="app">
      <DesktopSidebar activeMain={null} inStudio={false}
        onProjects={() => router.push("/")} onIdeas={() => router.push("/")} onMenu={() => router.push("/")}
        userInitial={userInitial} userAvatarUrl={userAvatarUrl} userDisplayName={userDisplayName} />
      <div className="app-content" style={{ background: "#121212", color: "#ededed", minHeight: "100vh", overflowY: "auto" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "30px 28px 96px" }}>{children}</div>
      </div>
    </div>
  );

  if (authLoading || !isAdmin(user?.email)) {
    return <Shell><div style={{ opacity: 0.5 }}>Loading…</div></Shell>;
  }

  return (
    <Shell>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: -0.3 }}>Style Lab</h1>
        <div style={{ fontSize: 12, opacity: 0.55 }}>
          {round > 0 ? `Round ${round}` : "Ready"}
        </div>
      </div>
      <p style={{ fontSize: 13, opacity: 0.6, margin: "0 0 22px", maxWidth: 640, lineHeight: 1.5 }}>
        Generate samples, pick your {PICK_TARGET} favorites, and the next batch leans toward your taste.
        The sliders show what the app is learning about your voice — drag any to steer it yourself.
      </p>

      {/* Convergence bar */}
      {convHistory.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.5, marginBottom: 5 }}>
            <span>Dialing in your voice</span><span>{Math.round(latestConv * 100)}%</span>
          </div>
          <div style={{ height: 5, background: "#262626", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(latestConv * 100)}%`, background: ACCENT, borderRadius: 999, transition: "width 400ms ease" }} />
          </div>
        </div>
      )}

      {/* Control panel: brief + the 6 dials */}
      <div style={{ background: "#1b1b1b", border: "1px solid #262626", borderRadius: 14, padding: 18, marginBottom: 22 }}>
        <input
          value={brief}
          onChange={e => setBrief(e.target.value)}
          placeholder="The moment to write…"
          style={{ width: "100%", background: "#111", color: "#ededed", border: "1px solid #2c2c2c", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 18 }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 28px" }}>
          {STYLE_AXES.map(axis => (
            <Dial
              key={axis.key}
              label={axis.label}
              blurb={axis.blurb}
              lowLabel={axis.lowLabel}
              highLabel={axis.highLabel}
              value={vector[axis.key] ?? 0.5}
              onChange={v => setVector(prev => ({ ...prev, [axis.key]: v }))}
            />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20, paddingTop: 16, borderTop: "1px solid #262626" }}>
          <span style={{ fontSize: 12, opacity: 0.55 }}>Variety</span>
          <input type="range" min={0.08} max={0.45} step={0.01} value={spread}
            onChange={e => setSpread(parseFloat(e.target.value))}
            style={{ width: 160, accentColor: ACCENT }} />
          <div style={{ flex: 1 }} />
          <button onClick={round === 0 ? restart : restart} disabled={generating}
            style={primaryBtn(generating)}>
            {generating ? "Generating…" : round === 0 ? "Generate" : "Restart"}
          </button>
        </div>
      </div>

      {/* Cards */}
      {candidates.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 22 }}>
            {candidates.map((c, i) => {
              const sel = selected.includes(i);
              const order = selected.indexOf(i);
              return (
                <div key={i}
                  onClick={() => toggleSelect(i)}
                  style={{
                    position: "relative", cursor: c.status === "done" ? "pointer" : "default",
                    background: sel ? "rgba(216,182,107,0.10)" : "#191919",
                    border: `1px solid ${sel ? ACCENT : "#262626"}`,
                    borderRadius: 12, padding: 13, minHeight: 124,
                    display: "flex", flexDirection: "column", gap: 9, transition: "border-color 150ms, background 150ms",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.45, lineHeight: 1.3 }}>{c.lean}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {sel && <span style={{ fontSize: 11, fontWeight: 800, color: ACCENT }}>{order + 1}</span>}
                      <button
                        onClick={e => { e.stopPropagation(); void regenerateOne(i); }}
                        title="Regenerate this one (same dials)"
                        style={{ background: "transparent", border: "none", color: "#777", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}
                      >↻</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", flex: 1, opacity: c.status === "done" ? 0.95 : 0.4, color: c.status === "error" ? "#c98" : undefined }}>
                    {c.status === "loading" ? "…" : c.text}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "sticky", bottom: 0, background: "#121212", padding: "14px 0", borderTop: "1px solid #262626" }}>
            <span style={{ fontSize: 13, opacity: 0.7 }}>{selected.length} / {PICK_TARGET} picked</span>
            <div style={{ flex: 1 }} />
            <button onClick={nextRound} disabled={!canAdvance} style={ghostBtn(!canAdvance)}>
              {generating ? "Generating…" : "Next round →"}
            </button>
            <button onClick={lockStyle} disabled={!canAdvance} style={primaryBtn(!canAdvance)}>
              {locking ? "Locking…" : "Lock this voice"}
            </button>
          </div>
        </>
      )}

      {lockError && (
        <div style={{ marginTop: 16, padding: 12, background: "rgba(220,80,80,0.12)", border: "1px solid #7a3030", borderRadius: 10, fontSize: 13 }}>
          Lock failed: {lockError}
        </div>
      )}
      {lockedRubric && (
        <div style={{ marginTop: 16, padding: 16, background: "rgba(216,182,107,0.08)", border: `1px solid ${ACCENT}`, borderRadius: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: ACCENT }}>✓ Voice locked — every script the app writes now uses it.</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", opacity: 0.9 }}>{lockedRubric}</div>
        </div>
      )}
    </Shell>
  );
}

// ─── Custom slider — sleek, animatable (programmatic moves transition;
//     dragging is live). Doubles as the "what we're learning" display. ──
function Dial({
  label, blurb, lowLabel, highLabel, value, onChange,
}: {
  label: string; blurb: string; lowLabel: string; highLabel: string;
  value: number; onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const setFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => setFromX(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const pct = Math.round(value * 100);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 10.5, opacity: 0.4, fontVariantNumeric: "tabular-nums" }}>{pct}</span>
      </div>
      <div style={{ fontSize: 10.5, opacity: 0.42, lineHeight: 1.35, marginBottom: 7, minHeight: 28 }}>{blurb}</div>
      <div
        ref={trackRef}
        onPointerDown={e => { setDragging(true); setFromX(e.clientX); }}
        style={{ position: "relative", height: 22, cursor: "pointer", display: "flex", alignItems: "center" }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, height: 4, background: "#2e2e2e", borderRadius: 999 }} />
        <div style={{ position: "absolute", left: 0, height: 4, width: `${pct}%`, background: ACCENT, borderRadius: 999, transition: dragging ? "none" : "width 380ms cubic-bezier(.2,.8,.2,1)" }} />
        <div style={{ position: "absolute", left: `${pct}%`, width: 13, height: 13, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.5)", transform: "translateX(-50%)", transition: dragging ? "none" : "left 380ms cubic-bezier(.2,.8,.2,1)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, opacity: 0.3, marginTop: 2 }}>
        <span>{lowLabel}</span><span>{highLabel}</span>
      </div>
    </div>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "#3a3424" : ACCENT, color: disabled ? "#7a7257" : "#1a1407",
    border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.7 : 1,
  };
}
function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent", color: disabled ? "#555" : "#ededed",
    border: `1px solid ${disabled ? "#2a2a2a" : "#3a3a3a"}`, borderRadius: 8, padding: "9px 16px",
    fontSize: 13, fontWeight: 600, cursor: disabled ? "default" : "pointer",
  };
}
