"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Story } from "@/lib/story";
import { ActionRequest } from "@/lib/prompt";

type Tab = "write" | "snippets" | "cost" | "configure";

export type Report = {
  model: string;
  action: string;
  ms: number;
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number };
  cost: { input: number; output: number; cacheWrite: number; cacheRead: number; total: number };
};

export function Studio({
  story,
  setStory,
  onBack,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("write");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTitle, setSheetTitle] = useState("Generating");
  const [reports, setReports] = useState<Report[]>([]);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  const totalSpent = useMemo(
    () => reports.reduce((s, r) => s + r.cost.total, 0),
    [reports]
  );

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
            if (msg.type === "text") setOutput(p => p + msg.value);
            else if (msg.type === "report") setReports(p => [msg.value, ...p]);
            else if (msg.type === "error") setOutput(p => p + "\n[error] " + msg.value);
          } catch {}
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // Voice capture
  function toggleRecord() {
    const SR: any =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      alert("Voice capture requires Safari or Chrome on a real device.");
      return;
    }
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript + " ";
        else interim += res[0].transcript;
      }
      const text = (finalText + interim).trim();
      if (text) {
        setStory(s => {
          const existing = s.snippets.find(x => x.id === "draft");
          const draft = {
            id: "draft",
            title: "Voice capture",
            content: text,
            tags: ["voice"],
            usedInBeats: [],
          };
          const snippets = existing
            ? s.snippets.map(x => (x.id === "draft" ? draft : x))
            : [draft, ...s.snippets];
          return { ...s, snippets };
        });
      }
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheetOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="page-enter">
      <div className="topbar">
        <button className="btn-icon" onClick={onBack} aria-label="Back">‹</button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div className="eyebrow">{story.settings.framework.replace(/-/g, " ")}</div>
          <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-0.01em", marginTop: 2 }}>
            {story.title || "Untitled"}
          </div>
        </div>
        {totalSpent > 0
          ? <div className="cost-chip">${totalSpent.toFixed(4)}</div>
          : <div style={{ width: 46 }} />}
      </div>

      <div className="screen-scroll" key={tab}>
        <div className="page-enter">
          {tab === "write"     && <WriteTab story={story} run={run} busy={busy} />}
          {tab === "snippets"  && <SnippetsTab story={story} />}
          {tab === "cost"      && <CostTab reports={reports} totalSpent={totalSpent} />}
          {tab === "configure" && <ConfigureTab story={story} setStory={setStory} run={run} busy={busy} />}
        </div>
      </div>

      {/* Mic */}
      <div className="mic-wrap">
        <button
          className={`mic ${recording ? "recording" : ""}`}
          onClick={toggleRecord}
          aria-label="Record idea"
        >
          <div className="core">{recording ? "■" : "●"}</div>
        </button>
      </div>

      {/* Tab bar */}
      <nav className="tabbar">
        <div className="tabbar-inner">
          {[
            { id: "write",     icon: "✦", label: "Write" },
            { id: "snippets",  icon: "❏", label: "Snippets" },
            { id: "cost",      icon: "◉", label: "Cost" },
            { id: "configure", icon: "⚙", label: "Setup" },
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

      {/* Streaming sheet */}
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
    </div>
  );
}

/* ===== Tabs ===== */

function WriteTab({
  story, run, busy,
}: { story: Story; run: (a: ActionRequest, title: string) => void; busy: boolean }) {
  return (
    <>
      <div className="neu-raised card">
        <span className="eyebrow">Studio</span>
        <div className="stack" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 4 }}>
          <button className="btn-chrome" disabled={busy}
            onClick={() => run({ type: "generate_beats", payload: {} }, "Beat sheet")}
            style={{ flex: "1 1 100%" }}>
            ✦ Generate beat sheet
          </button>
          <button className="btn-soft" disabled={busy}
            onClick={() => run({ type: "add_twist", payload: {} }, "Twist")}>
            ⚡ Add twist
          </button>
          <button className="btn-soft" disabled={busy}
            onClick={() => run(
              { type: "brainstorm", payload: { prompt: "unexpected openings" } },
              "Brainstorm"
            )}>
            ✎ Brainstorm
          </button>
          {story.beats[0] && (
            <button className="btn-soft" disabled={busy}
              onClick={() => run(
                { type: "generate_scene", payload: { beatIndex: 0 } },
                "Scene · Beat 1"
              )}>
              ➤ Write scene
            </button>
          )}
        </div>
      </div>

      <div className="neu-raised card">
        <span className="eyebrow">Beat sheet</span>
        {story.beats.length === 0 && (
          <div style={{ color: "var(--ink-mute)", fontSize: 14, marginTop: 4 }}>
            No beats yet. Tap <b>Generate beat sheet</b> above.
          </div>
        )}
        {story.beats.map((b, i) => (
          <div className="neu-inset-sm" style={{ padding: 14, marginTop: 10 }} key={b.id}>
            <div className="eyebrow">Beat {i + 1} · {b.name}</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{b.summary}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function SnippetsTab({ story }: { story: Story }) {
  return (
    <div className="neu-raised card">
      <span className="eyebrow">Snippets</span>
      {story.snippets.length === 0 ? (
        <div style={{ color: "var(--ink-mute)", fontSize: 14, marginTop: 4 }}>
          Tap the mic to capture an idea out loud. It'll live here.
        </div>
      ) : (
        story.snippets.map(sn => (
          <div className="neu-inset-sm" style={{ padding: 14, marginTop: 10 }} key={sn.id}>
            <div className="eyebrow">{sn.title} · {sn.tags.join(" · ")}</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{sn.content}</div>
          </div>
        ))
      )}
    </div>
  );
}

function CostTab({ reports, totalSpent }: { reports: Report[]; totalSpent: number }) {
  return (
    <>
      <div className="neu-raised card" style={{ textAlign: "center" }}>
        <span className="eyebrow">Session total</span>
        <div className="big-cost iris-text" style={{ marginTop: 8 }}>
          ${totalSpent.toFixed(4)}
        </div>
        <div style={{ color: "var(--ink-mute)", fontSize: 13, marginTop: 8 }}>
          Cached reads in green — that's where the savings live.
        </div>
      </div>
      <div className="neu-raised card">
        <span className="eyebrow">Requests</span>
        {reports.length === 0 && (
          <div style={{ color: "var(--ink-mute)", fontSize: 14, marginTop: 4 }}>
            No requests yet. Head to Write and tap an action.
          </div>
        )}
        {reports.map((r, i) => (
          <div key={i} className="neu-inset-sm report" style={{ marginTop: 10 }}>
            <div className="meta">{r.action} · {r.model.replace("claude-","")} · {r.ms}ms</div>
            <div className="tokens">
              in {r.tokens.input} · out {r.tokens.output}
              {r.tokens.cacheRead > 0 && <> · <span className="cached">cached {r.tokens.cacheRead}</span></>}
              {r.tokens.cacheWrite > 0 && <> · wrote {r.tokens.cacheWrite}</>}
            </div>
            <div className="amt">${r.cost.total.toFixed(5)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function ConfigureTab({
  story, setStory, run, busy,
}: {
  story: Story;
  setStory: (u: (s: Story) => Story) => void;
  run: (a: ActionRequest, title: string) => void;
  busy: boolean;
}) {
  const s = story.settings;
  const set = <K extends keyof Story["settings"]>(k: K, v: Story["settings"][K]) =>
    setStory(st => ({ ...st, settings: { ...st.settings, [k]: v } }));

  return (
    <>
      <div className="neu-raised card">
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

      <div className="neu-raised card">
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

      <div className="neu-raised card">
        <span className="eyebrow">Dials</span>
        <div className="stack" style={{ marginTop: 8 }}>
          <Slider label="Unpredictability" value={s.unpredictability} onChange={v => set("unpredictability", v)} />
          <Slider label="Darkness"         value={s.darkness}         onChange={v => set("darkness", v)} />
          <Slider label="Pace"             value={s.pace}             onChange={v => set("pace", v)} />
        </div>
      </div>

      <div className="neu-raised card">
        <span className="eyebrow">Ingredients</span>
        {story.ingredients.map(ing => (
          <div key={ing.id} className="neu-inset-sm" style={{ padding: 14, marginTop: 10 }}>
            <div className="eyebrow">{ing.label} {ing.locked && "· locked"}</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{ing.description}</div>
            <button className="chip" style={{ marginTop: 10 }} disabled={busy}
              onClick={() => run(
                { type: "swap_ingredient", payload: { ingredientId: ing.id } },
                `Swap · ${ing.label}`
              )}>
              Suggest swaps
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

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
