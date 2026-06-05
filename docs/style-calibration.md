# Style Calibration ("Style Lab")

A preference-elicitation tool. The writer repeatedly picks among
deliberately-varied prose samples; the app distills the picks into a
reusable **Style Profile** that steers every future script-prose
generation. Not ML fine-tuning — the "memory" is a paragraph of
instructions we prepend to every prompt.

Admin-gated for now (only the owner sees it). Per-user by design;
ungating for all users later is a one-line change.

---

## The mechanic (plain words)

1. Generate **15 short samples**, each written at a different point in
   "style space."
2. Writer picks **3 favorites**.
3. Picks move a **learned style vector** toward what they chose; the
   next 15 re-center on it. Repeat until picks converge.
4. **Lock** → one AI call distills the picks into an editable **rubric**.
5. The locked profile (rubric + axis targets + exemplars) is pasted
   into every script-prose prompt thereafter. Same profile in → same
   style out. Repeatable because the pasted text is fixed.

---

## The 7 style axes (the coordinate system)

Each is a 0–1 scalar. Three seed from metrics `writerProfile` already
computes, so a first position can be estimated from committed prose.

| Axis key | 0.0 ↔ 1.0 | Seedable from |
|---|---|---|
| `actionDialogue` | description-driven ↔ talk-driven | `dialogueDensity` |
| `subtext` | on-the-nose ↔ oblique | — |
| `density` | terse ↔ lush | `sentenceLenAvg` |
| `register` | plain ↔ literary | `vocabularyRichness` |
| `emotion` | restrained ↔ heightened | — |
| `sensory` | sparse ↔ rich concrete detail | — |
| `surprise` | conventional ↔ unexpected | (existing `unpredictability`) |

Axes are a starting set — cut/merge/add freely; they're the most
subjective, most "your taste" part.

---

## The artifact: `StyleProfile`

Nested inside `WriterProfile` (so it persists + ships to prompts for
free). Only the **locked** profile lives here; training scratch is
localStorage.

```ts
interface StyleProfile {
  version: number;             // bump on each Lock — keep v1, v2, …
  status: "locked";
  scope: "global" | { projectId: string };   // global, project can override
  axes: Record<AxisKey, number>;              // learned vector (0–1)
  rubric: string;                             // distilled, user-editable
  exemplars: { text: string; coord: Record<AxisKey, number> }[];  // 3–6 best
  lockedAt: string;
}
```

---

## The two formulas (repeatability)

**Update rule** — how 3 picks move your taste:
```
v_next = v_current + α · ( centroid(picks) − v_current )
```
`α` (learning rate) and the variant **spread** both decay as
convergence rises → wide exploration early, fine-tuning late.

**Injection** — how a locked profile becomes repeatable output:
```
locked StyleProfile → renderStyleProfileForPrompt() → cached system block
                      on every script-prose action
```
Identical block every call ⇒ consistent prose. Versioned for A/B.

---

## Variance engine (why 15 differ)

Not temperature spray. Each variant gets a **coordinate** — a structured
spread across the *active* axes, centered on the current vector. The
coord becomes a short style directive ("terse, high-subtext, plain,
restrained") prepended to the sample prompt. The writer controls which
axes are active and how wide they spread — that's "adjust the variance."

---

## Measurement

- **Convergence** = `1 − spread(last K selections)` → climbs to ~1 when settled.
- **Consistency** = inverse variance of an LLM-judge scoring 2 fresh
  locked-profile outputs on the 7 axes.
- Both shown live in the lab.

---

## Models + cost

| Step | Model | Why |
|---|---|---|
| Generate 15 variants | **Haiku** | variety, not polish; ~$0.10/round |
| Distill rubric (on Lock) | **Sonnet** | one reasoning call about taste |
| Real writing (after lock) | **Opus** | final artifact, guided by rubric |

Training samples are short (a paragraph / half-scene) — style is fully
visible in a paragraph, and short + Haiku keeps a full session to a
few dollars at most.

---

## New AI actions

- `style_sample` (Haiku) — input: a fixed test brief + one coordinate →
  output: one short prose sample written at that style.
- `distill_style_rubric` (Sonnet) — input: the 3–6 selected samples +
  their coords → output: `{ rubric: string }`, an editable voice bible.

---

## Build phases

0. This doc.
1. `lib/styleProfile.ts` — axes, types, sampler, update rule, convergence, render. Extend `WriterProfile` with `styleProfile?`.
2. Two AI actions (`prompt.ts` routing + `contextBuilder.ts` prompts).
3. `components/StyleLab.tsx` — admin-gated screen: brief + variance controls + 15-card grid + pick-3 + Next Round + Lock + meters.
4. Inject locked profile into `sync_*_to_script`, `generate_scene`, `tv_import_pilot`, `rewrite_highlighted_range`.
5. Build, deploy, run a real session, validate convergence + that a locked profile visibly changes script output.

---

## Out of scope (later)

- Per-layer training beyond Script prose (beats, concept tone, ideation).
- Ungating for all users.
- Auto-seeding the first vector from `writerProfile` metrics (nice-to-have; phase 2).
- Held-out blind A/B test harness.
