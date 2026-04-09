"use client";

import { useState } from "react";
import { Story, Ingredient } from "@/lib/story";

const GENRES = ["thriller","drama","comedy","horror","sci-fi","romance","action","mystery"];
const ENDINGS: { value: Story["settings"]["endingType"]; label: string; desc: string }[] = [
  { value: "happy",       label: "Happy",       desc: "Resolution and light." },
  { value: "bittersweet", label: "Bittersweet", desc: "Won, but it cost them." },
  { value: "tragic",      label: "Tragic",      desc: "The worst comes true." },
  { value: "ambiguous",   label: "Ambiguous",   desc: "The audience decides." },
  { value: "twist",       label: "Twist",       desc: "The rug is pulled." },
];
const FRAMEWORKS: { value: Story["settings"]["framework"]; title: string; sub: string }[] = [
  { value: "save-the-cat", title: "Save the Cat", sub: "15 beats. Commercial & precise." },
  { value: "heros-journey",title: "Hero's Journey", sub: "12 stages. Mythic & epic." },
  { value: "three-act",    title: "Three Act",   sub: "Setup, conflict, resolution." },
  { value: "story-circle", title: "Story Circle",sub: "8 steps. Character-driven." },
];

const STEPS = [
  "Name", "Shape", "Genre", "Vibe", "Character", "Ingredients", "Dials", "Ready",
];

export function Wizard({
  draft,
  setDraft,
  onCancel,
  onFinish,
}: {
  draft: Story;
  setDraft: (u: (s: Story) => Story) => void;
  onCancel: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);

  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1));
  const back = () => {
    if (step === 0) onCancel();
    else setStep(s => s - 1);
  };

  return (
    <div className="page-enter">
      <div className="topbar">
        <button className="btn-icon" onClick={back} aria-label="Back">‹</button>
        <div className="eyebrow">{STEPS[step]}</div>
        <button className="btn-icon" onClick={onCancel} aria-label="Close">✕</button>
      </div>

      <div className="progress">
        {STEPS.map((_, i) => (
          <div key={i} className={`dot ${i === step ? "active" : i < step ? "done" : ""}`} />
        ))}
      </div>

      <div className="screen-scroll" key={step /* remount to retrigger step animation */}>
        <div className="step">
          {step === 0 && <StepName draft={draft} setDraft={setDraft} />}
          {step === 1 && <StepFramework draft={draft} setDraft={setDraft} />}
          {step === 2 && <StepGenre draft={draft} setDraft={setDraft} />}
          {step === 3 && <StepVibe draft={draft} setDraft={setDraft} />}
          {step === 4 && <StepCharacter draft={draft} setDraft={setDraft} />}
          {step === 5 && <StepIngredients draft={draft} setDraft={setDraft} />}
          {step === 6 && <StepDials draft={draft} setDraft={setDraft} />}
          {step === 7 && <StepReady draft={draft} />}
        </div>
      </div>

      <div className="wizard-bar">
        {step < STEPS.length - 1 ? (
          <button
            className="btn-chrome"
            onClick={next}
            disabled={!canAdvance(step, draft)}
          >
            Continue
          </button>
        ) : (
          <button className="btn-chrome" onClick={onFinish}>
            Enter the studio
          </button>
        )}
      </div>
    </div>
  );
}

function canAdvance(step: number, d: Story) {
  if (step === 0) return d.title.trim().length > 0;
  if (step === 4) return d.characters.length > 0 && !!d.characters[0].name.trim();
  return true;
}

/* ========= STEPS ========= */

function StepName({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  return (
    <>
      <div className="display heading">Let's name it.</div>
      <div className="hero-sub">
        Give your story a working title. You can change it later — nothing here is permanent.
      </div>
      <input
        className="field"
        placeholder="The Quiet Room"
        value={draft.title}
        onChange={e => setDraft(s => ({ ...s, title: e.target.value }))}
        autoFocus
      />
      <div style={{ height: 14 }} />
      <textarea
        className="field"
        placeholder="A one-sentence logline (optional)"
        value={draft.logline}
        onChange={e => setDraft(s => ({ ...s, logline: e.target.value }))}
        rows={3}
      />
    </>
  );
}

function StepFramework({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  return (
    <>
      <div className="display heading">Choose a shape.</div>
      <div className="hero-sub">
        Every classic story has bones. Pick the skeleton that fits your instinct — you can swap later.
      </div>
      <div className="choice-grid">
        {FRAMEWORKS.map(f => (
          <button
            key={f.value}
            className={`choice ${draft.settings.framework === f.value ? "selected" : ""}`}
            onClick={() => setDraft(s => ({ ...s, settings: { ...s.settings, framework: f.value } }))}
          >
            <div className="choice-title">{f.title}</div>
            <div className="choice-sub">{f.sub}</div>
          </button>
        ))}
      </div>
    </>
  );
}

function StepGenre({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  return (
    <>
      <div className="display heading">What flavor?</div>
      <div className="hero-sub">
        Tap a genre. This sets the emotional register, not the rules — you can defy convention later.
      </div>
      <div className="chip-row">
        {GENRES.map(g => (
          <button
            key={g}
            className={`chip ${draft.settings.genre === g ? "selected" : ""}`}
            onClick={() => setDraft(s => ({ ...s, settings: { ...s.settings, genre: g as any } }))}
          >
            {g}
          </button>
        ))}
      </div>
    </>
  );
}

function StepVibe({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  return (
    <>
      <div className="display heading">Set the vibe.</div>
      <div className="hero-sub">
        Describe the atmosphere in a few words. Textures, lighting, the way the air feels.
      </div>
      <input
        className="field"
        placeholder="neon-lit, rainy, lonely"
        value={draft.settings.vibe}
        onChange={e => setDraft(s => ({ ...s, settings: { ...s.settings, vibe: e.target.value } }))}
      />
    </>
  );
}

function StepCharacter({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  const ch = draft.characters[0] ?? {
    id: "c1", name: "", role: "protagonist", want: "", need: "", notes: "",
  };
  const update = (patch: Partial<typeof ch>) => {
    setDraft(s => {
      const updated = { ...ch, ...patch };
      const next = s.characters.length ? s.characters.map((c, i) => i === 0 ? updated : c) : [updated];
      return { ...s, characters: next };
    });
  };
  return (
    <>
      <div className="display heading">Your protagonist.</div>
      <div className="hero-sub">
        The engine of the story. What they want drives the plot. What they need is what the story is actually about.
      </div>
      <div className="stack">
        <input className="field" placeholder="Name" value={ch.name} onChange={e => update({ name: e.target.value })} />
        <input className="field" placeholder="What they want (external)" value={ch.want} onChange={e => update({ want: e.target.value })} />
        <input className="field" placeholder="What they need (internal)" value={ch.need} onChange={e => update({ need: e.target.value })} />
      </div>
    </>
  );
}

function StepIngredients({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  const [label, setLabel] = useState("");
  const [desc, setDesc] = useState("");

  const add = () => {
    if (!desc.trim()) return;
    const ing: Ingredient = {
      id: "i_" + Math.random().toString(36).slice(2),
      label: label.trim() || "element",
      description: desc.trim(),
      locked: false,
    };
    setDraft(s => ({ ...s, ingredients: [...s.ingredients, ing] }));
    setLabel(""); setDesc("");
  };

  const remove = (id: string) =>
    setDraft(s => ({ ...s, ingredients: s.ingredients.filter(i => i.id !== id) }));

  const toggleLock = (id: string) =>
    setDraft(s => ({
      ...s,
      ingredients: s.ingredients.map(i => i.id === id ? { ...i, locked: !i.locked } : i),
    }));

  return (
    <>
      <div className="display heading">Raw ingredients.</div>
      <div className="hero-sub">
        Specific things the story should include — a setting, an object, a rule, a recurring image. Lock anything non-negotiable.
      </div>

      <div className="stack">
        <input className="field" placeholder="Type (setting, object, rule…)" value={label} onChange={e => setLabel(e.target.value)} />
        <textarea className="field" placeholder="Describe it" value={desc} onChange={e => setDesc(e.target.value)} rows={2} />
        <button className="btn-soft" onClick={add} disabled={!desc.trim()}>+ Add ingredient</button>
      </div>

      <div style={{ height: 16 }} />

      {draft.ingredients.map(i => (
        <div key={i.id} className="neu-raised-sm" style={{ padding: 16, marginBottom: 10 }}>
          <div className="eyebrow">{i.label} {i.locked && "· locked"}</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>{i.description}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="chip" onClick={() => toggleLock(i.id)}>
              {i.locked ? "Unlock" : "Lock"}
            </button>
            <button className="chip" onClick={() => remove(i.id)}>Remove</button>
          </div>
        </div>
      ))}
    </>
  );
}

function StepDials({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  const s = draft.settings;
  const set = <K extends keyof Story["settings"]>(k: K, v: Story["settings"][K]) =>
    setDraft(st => ({ ...st, settings: { ...st.settings, [k]: v } }));
  return (
    <>
      <div className="display heading">Fine-tune the feel.</div>
      <div className="hero-sub">
        These dials quietly shape every beat Claude writes. You can adjust them any time.
      </div>
      <div className="stack">
        <Slider label="Unpredictability" value={s.unpredictability} onChange={v => set("unpredictability", v)} />
        <Slider label="Darkness"         value={s.darkness}         onChange={v => set("darkness", v)} />
        <Slider label="Pace"             value={s.pace}             onChange={v => set("pace", v)} />
      </div>

      <div style={{ height: 20 }} />
      <div className="eyebrow" style={{ marginBottom: 10 }}>Ending</div>
      <div className="choice-grid">
        {ENDINGS.map(e => (
          <button
            key={e.value}
            className={`choice ${s.endingType === e.value ? "selected" : ""}`}
            onClick={() => set("endingType", e.value)}
          >
            <div className="choice-title">{e.label}</div>
            <div className="choice-sub">{e.desc}</div>
          </button>
        ))}
      </div>
    </>
  );
}

function StepReady({ draft }: { draft: Story }) {
  return (
    <>
      <div className="display heading">Everything's set.</div>
      <div className="hero-sub">
        Your creative brief is ready. In the studio you can generate your beat sheet, add twists, write scenes, and keep refining.
      </div>
      <div className="neu-raised-sm" style={{ padding: 20 }}>
        <div className="eyebrow">Brief</div>
        <div style={{ fontSize: 16, fontWeight: 900, marginTop: 6 }}>{draft.title}</div>
        {draft.logline && <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>{draft.logline}</div>}
        <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 12 }}>
          {draft.settings.framework.replace(/-/g, " ")} · {draft.settings.genre} · ending: {draft.settings.endingType}
        </div>
        {draft.settings.vibe && (
          <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 4 }}>Vibe: {draft.settings.vibe}</div>
        )}
      </div>
    </>
  );
}

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
