"use client";

import { useState } from "react";
import { Story, Genre, EndingType, Ingredient, ProjectType } from "@/lib/story";

const ALL_GENRES: Genre[] = ["thriller","drama","comedy","horror","sci-fi","romance","action","mystery"];
const ENDINGS: { value: EndingType; label: string; desc: string }[] = [
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
const PROJECT_TYPES: { value: ProjectType; title: string; sub: string }[] = [
  { value: "feature",  title: "Feature Film", sub: "90-120 min. Full story arc." },
  { value: "short",    title: "Short Film",   sub: "Under 40 min. Tight & focused." },
  { value: "tv-show",  title: "TV Show",      sub: "Episodes. Serialized story." },
];

const STEPS = [
  "Type", "Name", "Shape", "Genre", "Vibe", "Character", "Ingredients", "Dials", "Ready",
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
  const skip = () => next();

  const isFinal = step === STEPS.length - 1;

  return (
    <>
      <div className="topbar">
        <button className="topbar-btn" onClick={back} aria-label="Back">
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="topbar-center">{STEPS[step]}</div>
        <button className="topbar-btn" onClick={onCancel} aria-label="Close">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="progress-dots">
        {STEPS.map((_, i) => (
          <div key={i} className={`dot ${i === step ? "active" : i < step ? "done" : ""}`} />
        ))}
      </div>

      <div className="screen-scroll" key={step}>
        <div className="step">
          {step === 0 && <StepType draft={draft} setDraft={setDraft} />}
          {step === 1 && <StepName draft={draft} setDraft={setDraft} />}
          {step === 2 && <StepFramework draft={draft} setDraft={setDraft} />}
          {step === 3 && <StepGenre draft={draft} setDraft={setDraft} />}
          {step === 4 && <StepVibe draft={draft} setDraft={setDraft} />}
          {step === 5 && <StepCharacter draft={draft} setDraft={setDraft} />}
          {step === 6 && <StepIngredients draft={draft} setDraft={setDraft} />}
          {step === 7 && <StepDials draft={draft} setDraft={setDraft} />}
          {step === 8 && <StepReady draft={draft} />}
        </div>
      </div>

      <div className="wizard-bar">
        {!isFinal ? (
          <>
            <button
              className="btn-secondary"
              onClick={skip}
              style={{ minWidth: 70, fontSize: 14 }}
            >
              Skip
            </button>
            <button className="btn-primary" onClick={next}>
              Continue
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={onFinish}>
            Enter the studio
          </button>
        )}
      </div>
    </>
  );
}

/* ========= STEPS ========= */

function StepType({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  return (
    <>
      <div className="display heading">What are you making?</div>
      <div className="body-text">Pick the format. This shapes how the project is organized.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {PROJECT_TYPES.map(pt => (
          <button
            key={pt.value}
            className={`choice ${draft.projectType === pt.value ? "selected" : ""}`}
            onClick={() => setDraft(s => ({ ...s, projectType: pt.value }))}
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
          <input
            className="field"
            type="number"
            min={1}
            max={24}
            placeholder="e.g. 8"
            value={draft.episodes?.length ?? ""}
            onChange={e => {
              const count = Math.max(1, Math.min(24, parseInt(e.target.value) || 1));
              setDraft(s => ({
                ...s,
                episodes: Array.from({ length: count }, (_, i) => ({
                  id: `ep_${i + 1}`,
                  title: `Episode ${i + 1}`,
                  number: i + 1,
                  beats: [],
                })),
              }));
            }}
          />
        </div>
      )}
    </>
  );
}

function StepName({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  return (
    <>
      <div className="display heading">Let's name it.</div>
      <div className="body-text">Give your story a working title. You can change it later.</div>
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
      <div className="body-text">Every classic story has bones. Pick the skeleton that fits your instinct.</div>
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
  const toggleGenre = (g: Genre) => {
    setDraft(s => {
      const current = s.settings.genres;
      const next = current.includes(g)
        ? current.filter(x => x !== g)
        : [...current, g];
      return { ...s, settings: { ...s.settings, genres: next } };
    });
  };
  return (
    <>
      <div className="display heading">What flavor?</div>
      <div className="body-text">Tap one or more genres to blend together.</div>
      <div className="chip-row">
        {ALL_GENRES.map(g => (
          <button
            key={g}
            className={`chip ${draft.settings.genres.includes(g) ? "selected" : ""}`}
            onClick={() => toggleGenre(g)}
          >
            {g}
          </button>
        ))}
      </div>
      {draft.settings.genres.length > 1 && (
        <div className="caption" style={{ marginTop: 12 }}>
          Blend: {draft.settings.genres.join(" + ")}
        </div>
      )}
    </>
  );
}

function StepVibe({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  return (
    <>
      <div className="display heading">Set the vibe.</div>
      <div className="body-text">Describe the atmosphere in a few words. Textures, lighting, the way the air feels.</div>
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
    id: "c1", name: "", role: "protagonist", archetype: "", backstory: "",
    motivations: "", flaws: "", want: "", need: "", relationships: [],
    voice: "", arc: "", notes: "",
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
      <div className="body-text">What they want drives the plot. What they need is what the story is actually about.</div>
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

  return (
    <>
      <div className="display heading">Raw ingredients.</div>
      <div className="body-text">Specific things the story should include. Lock anything non-negotiable.</div>
      <div className="stack">
        <input className="field" placeholder="Type (setting, object, rule…)" value={label} onChange={e => setLabel(e.target.value)} />
        <textarea className="field" placeholder="Describe it" value={desc} onChange={e => setDesc(e.target.value)} rows={2} />
        <button className="btn-secondary" onClick={add} disabled={!desc.trim()}>+ Add ingredient</button>
      </div>
      <div style={{ height: 16 }} />
      {draft.ingredients.map(i => (
        <div key={i.id} className="inset-card" style={{ marginBottom: 10 }}>
          <div className="eyebrow">{i.label}</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>{i.description}</div>
          <button className="chip" style={{ marginTop: 8, fontSize: 11, padding: "4px 10px" }}
            onClick={() => remove(i.id)}>Remove</button>
        </div>
      ))}
    </>
  );
}

function StepDials({ draft, setDraft }: { draft: Story; setDraft: (u: (s: Story) => Story) => void }) {
  const s = draft.settings;
  const set = <K extends keyof Story["settings"]>(k: K, v: Story["settings"][K]) =>
    setDraft(st => ({ ...st, settings: { ...st.settings, [k]: v } }));

  const toggleEnding = (e: EndingType) => {
    setDraft(st => {
      const current = st.settings.endingTypes;
      const next = current.includes(e)
        ? current.filter(x => x !== e)
        : [...current, e];
      return { ...st, settings: { ...st.settings, endingTypes: next } };
    });
  };

  return (
    <>
      <div className="display heading">Fine-tune the feel.</div>
      <div className="body-text">These dials shape every beat. You can adjust them any time.</div>
      <div className="stack">
        <Slider label="Unpredictability" value={s.unpredictability} onChange={v => set("unpredictability", v)} />
        <Slider label="Darkness"         value={s.darkness}         onChange={v => set("darkness", v)} />
        <Slider label="Pace"             value={s.pace}             onChange={v => set("pace", v)} />
      </div>

      <div style={{ height: 20 }} />
      <div className="eyebrow" style={{ marginBottom: 10 }}>Ending (select one or more)</div>
      <div className="choice-grid">
        {ENDINGS.map(e => (
          <button
            key={e.value}
            className={`choice ${s.endingTypes.includes(e.value) ? "selected" : ""}`}
            onClick={() => toggleEnding(e.value)}
          >
            <div className="choice-title">{e.label}</div>
            <div className="choice-sub">{e.desc}</div>
          </button>
        ))}
      </div>
      {s.endingTypes.length > 1 && (
        <div className="caption" style={{ marginTop: 12 }}>
          Blend: {s.endingTypes.join(" + ")}
        </div>
      )}
    </>
  );
}

function StepReady({ draft }: { draft: Story }) {
  return (
    <>
      <div className="display heading">Everything's set.</div>
      <div className="body-text">
        Your creative brief is ready. In the studio you can build your beat sheet, link moments, and write scenes.
      </div>
      <div className="card">
        <div className="eyebrow">Brief</div>
        <div style={{ fontSize: 16, fontWeight: 900, marginTop: 6 }}>{draft.title || "Untitled"}</div>
        <div className="caption" style={{ marginTop: 4 }}>{draft.projectType}</div>
        {draft.logline && <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>{draft.logline}</div>}
        <div className="caption" style={{ marginTop: 12 }}>
          {draft.settings.framework.replace(/-/g, " ")}
          {draft.settings.genres.length > 0 && ` · ${draft.settings.genres.join(", ")}`}
          {draft.settings.endingTypes.length > 0 && ` · ending: ${draft.settings.endingTypes.join(", ")}`}
        </div>
        {draft.settings.vibe && (
          <div className="caption" style={{ marginTop: 4 }}>Vibe: {draft.settings.vibe}</div>
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
