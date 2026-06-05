"use client";

// Style Lab — admin-only prose-voice calibration tool.
// See docs/style-calibration.md. The writer generates 15 short samples
// per round (each at a different style coordinate), picks 3 favorites,
// and the picks move a learned style vector. On Lock we distill an
// editable rubric and freeze a StyleProfile into the user's
// WriterProfile, which then steers every script-prose generation.
//
// Cost: each round = 15 short Haiku samples (~$0.10). Distill = 1 Sonnet
// call. The "real writing" stays on Opus, guided by the locked profile.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { DesktopSidebar, deriveSidebarUserFields } from "@/components/DesktopSidebar";
import { Button } from "@/components/ui";
import { newBlankProject } from "@/lib/storage";
import { loadWriterProfileFromDB, saveWriterProfileToDB } from "@/lib/writerProfileStore";
import { emptyProfile } from "@/lib/writerProfile";
import { callGenerate, extractJson } from "@/lib/syncLayer";
import {
  STYLE_AXES, AXIS_KEYS, type AxisKey, type StyleCoord,
  neutralCoord, sampleCoords, coordToDirective, coordSummary,
  updateVector, convergence, alphaForRound, spreadForRound,
  type StyleProfile,
} from "@/lib/styleProfile";

const ROUND_SIZE = 15;
const PICK_TARGET = 3;
const DEFAULT_BRIEF =
  "A two-character scene: one wants something the other won't give. A single location, mid-conversation. No action plot — just two people and what's unsaid between them.";

interface Candidate {
  coord: StyleCoord;
  lean: string;
  text: string;
  status: "loading" | "done" | "error";
}

export default function StyleLabPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // ── gate ──
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin(user?.email)) router.replace("/");
  }, [authLoading, user?.email, router]);

  // ── training state ──
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [activeAxes, setActiveAxes] = useState<Set<AxisKey>>(() => new Set(AXIS_KEYS));
  const [spread, setSpread] = useState(0.35);
  const [vector, setVector] = useState<StyleCoord>(() => neutralCoord());
  const [round, setRound] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [generating, setGenerating] = useState(false);
  const [convHistory, setConvHistory] = useState<number[]>([]);

  // ── lock state ──
  const [locking, setLocking] = useState(false);
  const [lockedRubric, setLockedRubric] = useState<string | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);

  // A blank synthetic project gives callGenerate a valid (near-empty)
  // bible so style samples are driven purely by brief + directive, not
  // colored by any real project's genre/characters. Built once.
  const synthStory = useMemo(() => newBlankProject(), []);

  const { userInitial, userAvatarUrl, userDisplayName } = deriveSidebarUserFields(user);

  // ── generate one round ──
  const runRound = useCallback(async (forVector: StyleCoord, forSpread: number, roundIdx: number) => {
    setGenerating(true);
    setSelected([]);
    setLockedRubric(null);
    setLockError(null);
    const coords = sampleCoords(ROUND_SIZE, forVector, [...activeAxes], forSpread, roundIdx);
    // Seed placeholders so the grid renders immediately.
    setCandidates(coords.map(coord => ({
      coord,
      lean: coordSummary(coord),
      text: "",
      status: "loading" as const,
    })));
    // Fire all 15 in parallel; fill each card as it resolves.
    await Promise.all(coords.map(async (coord, i) => {
      try {
        const directive = coordToDirective(coord);
        const text = await callGenerate(
          synthStory,
          { type: "style_sample", payload: { brief, directive } },
          null, // no writer profile — keep samples neutral + directive-driven
        );
        setCandidates(prev => {
          const next = [...prev];
          if (next[i]) next[i] = { ...next[i], text: text.trim(), status: "done" };
          return next;
        });
      } catch {
        setCandidates(prev => {
          const next = [...prev];
          if (next[i]) next[i] = { ...next[i], text: "(generation failed)", status: "error" };
          return next;
        });
      }
    }));
    setGenerating(false);
  }, [activeAxes, brief, synthStory]);

  const startFirstRound = () => {
    setVector(neutralCoord());
    setRound(1);
    setConvHistory([]);
    void runRound(neutralCoord(), spread, 1);
  };

  const toggleSelect = (i: number) => {
    setSelected(prev => {
      if (prev.includes(i)) return prev.filter(x => x !== i);
      if (prev.length >= PICK_TARGET) return prev; // cap at 3
      return [...prev, i];
    });
  };

  const pickedCoords = (): StyleCoord[] => selected.map(i => candidates[i].coord);

  const nextRound = () => {
    const picks = pickedCoords();
    const conv = convergence(picks);
    const alpha = alphaForRound(conv);
    const nextVec = updateVector(vector, picks, alpha);
    const nextSpread = spreadForRound(conv);
    setVector(nextVec);
    setSpread(nextSpread);
    setConvHistory(h => [...h, conv]);
    const r = round + 1;
    setRound(r);
    void runRound(nextVec, nextSpread, r);
  };

  const lockStyle = async () => {
    if (!user?.id) { setLockError("Not signed in."); return; }
    const picks = pickedCoords();
    if (picks.length === 0) return;
    setLocking(true);
    setLockError(null);
    try {
      const samples = selected.map(i => ({
        text: candidates[i].text,
        lean: candidates[i].lean,
      }));
      const raw = await callGenerate(
        synthStory,
        { type: "distill_style_rubric", payload: { samples } },
        null,
      );
      const parsed = extractJson(raw);
      const rubric: string = typeof parsed?.rubric === "string" && parsed.rubric.trim()
        ? parsed.rubric.trim()
        : samples.map(s => `- ${s.lean}`).join("\n");

      // Final vector incorporates this round's picks.
      const conv = convergence(picks);
      const finalVec = updateVector(vector, picks, alphaForRound(conv));

      // Load the existing profile (or a fresh one), bump the style
      // version, write the locked StyleProfile, save.
      const existing = (await loadWriterProfileFromDB(user.id)) ?? emptyProfile();
      const prevVersion = existing.styleProfile?.version ?? 0;
      const styleProfile: StyleProfile = {
        version: prevVersion + 1,
        status: "locked",
        scope: "global",
        axes: finalVec,
        rubric,
        exemplars: selected.slice(0, 4).map(i => ({
          text: candidates[i].text,
          coord: candidates[i].coord,
        })),
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
      <DesktopSidebar
        activeMain={null}
        inStudio={false}
        onProjects={() => router.push("/")}
        onIdeas={() => router.push("/")}
        onMenu={() => router.push("/")}
        userInitial={userInitial}
        userAvatarUrl={userAvatarUrl}
        userDisplayName={userDisplayName}
      />
      <div className="app-content" style={{ background: "#161616", color: "#eee", minHeight: "100vh", overflowY: "auto" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 28px 80px" }}>
          {children}
        </div>
      </div>
    </div>
  );

  if (authLoading || !isAdmin(user?.email)) {
    return <Shell><div style={{ opacity: 0.6 }}>Loading…</div></Shell>;
  }

  return (
    <Shell>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Style Lab</h1>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {round > 0 ? `Round ${round}` : "Not started"}
          {convHistory.length > 0 && ` · convergence ${(latestConv * 100).toFixed(0)}%`}
        </div>
      </div>
      <p style={{ fontSize: 13, opacity: 0.65, marginTop: 0, marginBottom: 24, maxWidth: 680 }}>
        Generate {ROUND_SIZE} short samples, pick your {PICK_TARGET} favorites, and the next batch shifts toward your taste.
        When the samples all feel right, lock the style — every script the app writes will use it.
      </p>

      {/* Brief + variance controls */}
      <div style={{ background: "#1f1f1f", borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.5 }}>Test brief</label>
        <textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          rows={2}
          style={{ width: "100%", marginTop: 6, marginBottom: 14, background: "#111", color: "#eee", border: "1px solid #333", borderRadius: 6, padding: 10, fontSize: 13, resize: "vertical" }}
        />
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.5 }}>Axes in play (which dials vary)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 14 }}>
          {STYLE_AXES.map(axis => {
            const on = activeAxes.has(axis.key);
            return (
              <button
                key={axis.key}
                onClick={() => setActiveAxes(prev => {
                  const n = new Set(prev);
                  if (n.has(axis.key)) n.delete(axis.key); else n.add(axis.key);
                  return n;
                })}
                style={{
                  fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${on ? "#6aa6ff" : "#333"}`,
                  background: on ? "rgba(106,166,255,0.16)" : "transparent",
                  color: on ? "#cfe0ff" : "#888",
                }}
                title={`${axis.lowLabel} ↔ ${axis.highLabel}`}
              >
                {axis.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.5 }}>Spread</label>
          <input type="range" min={0.05} max={0.5} step={0.05} value={spread}
            onChange={e => setSpread(parseFloat(e.target.value))} style={{ flex: 1, maxWidth: 240 }} />
          <span style={{ fontSize: 12, opacity: 0.6, width: 32 }}>{spread.toFixed(2)}</span>
          <div style={{ flex: 1 }} />
          {round === 0
            ? <Button variant="primary" size="sm" onClick={startFirstRound} disabled={generating || activeAxes.size === 0}>
                {generating ? "Generating…" : "Generate 15"}
              </Button>
            : <Button variant="secondary" size="sm" onClick={startFirstRound} disabled={generating}>Restart</Button>}
        </div>
      </div>

      {/* Candidate grid */}
      {candidates.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {candidates.map((c, i) => {
              const sel = selected.includes(i);
              const order = selected.indexOf(i);
              return (
                <button
                  key={i}
                  onClick={() => c.status === "done" && toggleSelect(i)}
                  disabled={c.status !== "done"}
                  style={{
                    textAlign: "left", cursor: c.status === "done" ? "pointer" : "default",
                    background: sel ? "rgba(106,166,255,0.12)" : "#1c1c1c",
                    border: `1px solid ${sel ? "#6aa6ff" : "#2a2a2a"}`,
                    borderRadius: 10, padding: 12, color: "#ddd", position: "relative", minHeight: 150,
                    display: "flex", flexDirection: "column", gap: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.5 }}>#{i + 1} · {c.lean}</span>
                    {sel && <span style={{ fontSize: 11, fontWeight: 700, color: "#6aa6ff" }}>✓ {order + 1}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", opacity: c.status === "loading" ? 0.4 : 1, flex: 1 }}>
                    {c.status === "loading" ? "…" : c.text}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Round actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "sticky", bottom: 0, background: "#161616", padding: "14px 0", borderTop: "1px solid #2a2a2a" }}>
            <span style={{ fontSize: 13, opacity: 0.7 }}>
              {selected.length}/{PICK_TARGET} selected
            </span>
            <div style={{ flex: 1 }} />
            <Button variant="secondary" size="sm" onClick={nextRound} disabled={!canAdvance}>
              {generating ? "Generating…" : "Next round →"}
            </Button>
            <Button variant="primary" size="sm" onClick={lockStyle} disabled={!canAdvance}>
              {locking ? "Locking…" : "Lock style"}
            </Button>
          </div>
        </>
      )}

      {/* Lock result */}
      {lockError && (
        <div style={{ marginTop: 16, padding: 12, background: "rgba(255,80,80,0.12)", border: "1px solid #803030", borderRadius: 8, fontSize: 13 }}>
          Lock failed: {lockError}
        </div>
      )}
      {lockedRubric && (
        <div style={{ marginTop: 16, padding: 16, background: "rgba(106,255,166,0.08)", border: "1px solid #2f7a4f", borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>✓ Style locked — every script the app writes now uses this voice.</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", opacity: 0.9 }}>{lockedRubric}</div>
        </div>
      )}
    </Shell>
  );
}
