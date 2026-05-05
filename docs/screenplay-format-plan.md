# Screenplay format — making Unfold's output production-ready

Goal: Unfold's exported PDF and Fountain files should be byte-comparable
to Final Draft's industry-standard output, so a reader can't tell a
Unfold-generated screenplay wasn't done in Final Draft. This is a
v2-rollout deliverable; v1 stays on the existing free-form pipeline.

**Status when this doc was written**: gap analysis complete, awaiting
the user to provide a Final-Draft-exported reference PDF before
implementation starts. See "Open questions" at the bottom.

---

## What "production-ready" means

Final Draft is what's submitted to studios, agencies, festivals, the WGA.
The bar is two things:

1. The PDF Unfold renders looks indistinguishable from one a working
   writer would export from FD.
2. Importing Unfold's `.fountain` file into FD produces a clean FD
   project with no manual cleanup.

---

## Final Draft / industry standard (the spec)

**Page**: US Letter, Courier 12pt (exactly 10 cpi → 60 chars max line in
action, 35 in dialogue), 1" top/bottom/right, 1.5" left (binding). Page
numbers top-right as `1.` (period included). No number on page 1.

**Element model** — every text block is one of seven typed elements with
strict positioning:

| Element | Case | Position from page-left |
|---|---|---|
| Scene Heading (slug) | ALL CAPS | 1.5" |
| Action | Sentence | 1.5"–7.5" (full width) |
| Character | ALL CAPS | 3.7" |
| Parenthetical | (lowercase) | 3.1", ~2" wide |
| Dialogue | Sentence | 2.5", ~3.5" wide |
| Transition | ALL CAPS + `:` | Right-aligned 7.5" |
| Shot | ALL CAPS | 1.5" (rare) |

**Slug conventions**:
- `INT./EXT./EST.` prefix, period, location, hyphen, time-of-day
- Time-of-day vocabulary: DAY, NIGHT, MORNING, EVENING, CONTINUOUS,
  LATER, MOMENTS LATER, SAME TIME, SUNSET, SUNRISE
- `INT./EXT.` for scenes that toggle indoor/outdoor
- `MONTAGE -` for montages with `- A:`, `- B:` sub-items

**Continuation rules**:
- Dialogue breaking across pages → `(MORE)` at bottom of page 1,
  `CHARACTER (CONT'D)` at top of page 2
- Same character speaking twice with action between → second cue is
  `CHARACTER (CONT'D)`
- Scene breaking across pages → `(CONTINUED)` at bottom, slug
  `CONTINUED:` at top

**Character extensions** after name in parens: `(O.S.)` off-screen,
`(V.O.)` voice-over, `(O.C.)` off-camera, `(CONT'D)`, `(FILTERED)`,
`(ON PHONE)`, `(PRELAP)`. Inline pause: `(beat)`.

**Title page**: separate page, Title centered ~1/3 down, `Written by\n
Author` two lines below, contact block bottom-left, draft/date
bottom-right.

---

## What Unfold actually produces today (the gap)

| Layer | Status | What's wrong |
|---|---|---|
| `Scene.content: string` | ❌ free-form blob | No element types. We don't know what's character vs. dialogue at storage time — only what the LLM happened to type. |
| LLM prompt (`syncPrompt_toScript` in `lib/contextBuilder.ts:898`) | ⚠️ asks for "industry format" | No structural enforcement. Caps inconsistency, missing parentheticals, em-dash-for-paren mistakes go unpoliced. |
| PDF renderer (`lib/email/projectPdf.tsx`) | ❌ two element types only | Renders a `slug` (Courier-Bold uppercase) + an `action` block (entire content blob, including dialogue, in one `<Text>`). No character indentation. No dialogue indentation. No parentheticals. No transitions. No (MORE)/(CONT'D). Title page is custom Helvetica branding, not FD-canonical. |
| Fountain export (`lib/fountain.ts`) | ⚠️ structure ok, body fragile | Title page metadata + slug normalization + FADE IN/OUT all good. But scene body dumps `content` verbatim, so any LLM-introduced format drift goes straight into the FD import. |
| Page count tracking | ❌ none | No "this scene is 1.5 pages" anywhere. |
| Character extensions ((O.S.), (V.O.)) | ❌ inline-only, untyped | Whatever the LLM produces in prose. |

The team's own comment in `lib/email/projectPdf.tsx` already
acknowledges this: *"Not strict Hollywood format — we don't parse
character names / dialogue out of the free-form `scene.content`
string..."*

---

## The plan — three phases

### Phase 1: Typed element model (load-bearing)

The structural change everything else depends on.

**Data model changes** (`lib/story.ts`):
- New type: `ScreenplayElement = { type: "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition", text: string, characterExtension?: "O.S." | "V.O." | "CONT'D" | "O.C." | "FILTERED" | "ON PHONE" | "PRELAP" }`
- New optional field on `Scene`: `elements?: ScreenplayElement[]`
- Existing `content: string` stays for backwards compat — scenes
  without `elements` still render via the legacy free-form path.

**LLM prompt rewrite** (`lib/contextBuilder.ts`):
- `syncPrompt_toScript` returns an `elements` array per scene instead
  of a free-form `content` string.
- Strict JSON schema for each element type, validated server-side.
- Per-element guidance baked into the system prompt (e.g. "Character
  names ALL CAPS, no period after; parentheticals lowercase inside
  parens; dialogue sentence case").

**Migration** (`lib/scriptParse.ts` extension):
- One-time heuristic parser that converts existing `scene.content`
  blobs into `elements`. Heuristics:
  - ALL-CAPS line followed by non-empty next line → character + dialogue
  - `(paren'd)` lines → parenthetical
  - Right-aligned ALL-CAPS ending in `:` → transition
  - Everything else → action
- Run lazily (on read) rather than as a big DB migration so v1 users
  are untouched.

**v2 gating**:
- `lib/v2Access.ts` already has `isV2User(email)` — extend the LLM
  prompt path so v2 users get the new element-emitting prompt and v1
  users keep the legacy prose prompt.
- This means v1 and v2 can coexist on the same backend without
  conflict.

### Phase 2: Proper rendering (mechanical once Phase 1 lands)

**PDF renderer** (`lib/email/projectPdf.tsx`):
- Per-element styles with exact margins:
  - scene_heading: 1.5" left, ALL CAPS, Courier-Bold
  - action: 1.5"–7.5" full width, Courier
  - character: 3.7" left, ALL CAPS, Courier
  - parenthetical: 3.1" left, ~2" wide, lowercase parens, Courier
  - dialogue: 2.5" left, ~3.5" wide, Courier
  - transition: right-aligned to 7.5", ALL CAPS, Courier
- Title page rebuilt in FD-canonical layout (Title 1/3 down centered,
  Written by + Author two lines below, contact bottom-left, draft +
  date bottom-right). Drop the Unfold-branded version for v2.
- Page numbering keeps `1.` format, no number on page 1.

**Fountain serializer** (`lib/fountain.ts`):
- Emit canonical Fountain per element type:
  - `@CHARACTER NAME` for forced character cues (avoids ambiguity
    parsers)
  - Indented dialogue
  - `(parenthetical)` on its own line
  - `> CENTERED:` for centered transitions, `CUT TO:` etc.
- Element-aware emission instead of dumping `content` verbatim.

### Phase 3: Continuations & polish

**Page-break machinery**:
- (MORE)/(CONT'D) on dialogue page breaks. Requires page-aware
  rendering — @react-pdf can do this via `wrap={true}` with
  break callbacks, or we precompute page boundaries and inject
  the markers.
- Auto-insert `(CONT'D)` when same character speaks twice with action
  between — happens at element-emission time in the LLM prompt.

**Editor surfaces**:
- Character-extension picker in the read-through editor (dropdown
  for O.S./V.O./CONT'D/etc.).
- Page-count display in editor sidebar: "Scene 12 — 1.5 pages, 7m 30s".
- Scene number column for production drafts (left + right margins).

---

## Open questions (answer before starting)

1. **Reference PDF.** User to provide a Final-Draft-exported PDF that
   represents the gold-standard target. Drop it in `docs/reference/`
   and reference here. Without it, Phase 2 layout decisions (exact
   font, exact margins, exact title page geometry) are
   approximate-from-memory rather than match-exactly.

2. **Phase 1 v2-gating confirmed?** Default plan is: v2 users get
   typed-element scenes, v1 users keep free-form. When v2 becomes the
   global default, we run the migration parser across all existing
   scenes. Confirm this trade-off is OK (alternative: migrate
   everyone immediately, accept v1 disruption).

3. **Scope of MVP.** Is the goal "PDF that fools a casual reader" (Phase
   1+2 sufficient) or "PDF that survives WGA submission" (need Phase 3
   too)? Affects priority of (MORE)/(CONT'D), scene numbering, etc.

---

## Resuming this work

When ready to pick this up, tell me: *"Re-read
`docs/screenplay-format-plan.md` and let's start Phase 1"* (or
whichever phase) — the file is the contract.

Files this plan touches when implementation starts:
- `lib/story.ts` — add `ScreenplayElement` type + `Scene.elements`
- `lib/contextBuilder.ts` — rewrite `syncPrompt_toScript` for v2
- `lib/email/projectPdf.tsx` — element-aware rendering
- `lib/fountain.ts` — element-aware emission
- `lib/scriptParse.ts` — content-to-elements heuristic parser
- `lib/v2Access.ts` — already has `isV2User`, no changes needed
- `components/Studio.tsx` — read-through editor: character-extension
  picker, page-count sidebar (Phase 3)

No code has been written yet for any phase.
