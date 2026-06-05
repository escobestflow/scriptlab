# CLAUDE.md

Standing instructions for this repo. Read this first, every session.
For depth, see **`ONBOARDING.md`** (full architecture + UX) and
**`PRINCIPLES.md`** (the creative philosophy every feature is checked
against). This file is the operational layer — what's easy to get
wrong and must always hold.

> **Name note:** the app is **Unfold** (user-facing). Older docs/code
> say "ScriptLab" / "ScriptWriter POC" — same app. Prefer "Unfold" in
> new user-facing copy.

---

## Operating rules (non-negotiable)

- **Deploy after every push.** After `git push`, run `npx vercel --prod --yes`
  in the same turn. The user verifies on their phone at
  `script-lab-beta.vercel.app`. A push without a deploy is an incomplete task.
- **Branch, don't commit to a dirty `main` blindly** — but this repo
  works directly on `main`. Always create *new* commits; never `--amend`,
  never force-push, never skip hooks.
- **Verify before deploying.** `npx next build` must pass (it runs the
  full type-check). Don't push a build you haven't run.
- **Secrets never touch the repo or local shell.** Never read, echo, or
  commit `.env*`. Never run a command that needs a real secret value
  locally — the deployed environment owns those.
- **Commit trailer:** end commit messages with
  `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- **Cost is real money.** Image generation and Opus calls bill per use.
  Default to the cheap path; see "Cost discipline" below.

---

## What Unfold is

A desktop+mobile web app for writing TV / film / short screenplays with
heavy, iterative AI assistance. The user moves through **layers** —
Concept → Characters → Story (beats) → Script (prose), plus Episodes and
Arcs for TV. Each layer has a **pool of drafts** so the writer can
branch and compare. AI actions read the structured story state and write
back into it. The thesis (see `README.md`): make heavy AI use cheap via
prompt caching + model routing + a single structured `Story` JSON.

---

## Stack

Next.js 14 (App Router) · TypeScript · React 18 · Supabase (Postgres +
Auth + Storage) · Anthropic SDK · OpenAI images · `sharp` · Resend
(email) · `@react-pdf/renderer` (export). Deployed on Vercel.

```bash
npm run dev          # local at :3000
npx next build       # type-check + build — the gate before push
npx vercel --prod --yes   # deploy (always, right after push)
```

---

## Architecture you must know

**`lib/story.ts` is the single source of truth.** The `Story` type holds
everything; the UI edits it, the AI reads/writes it. It exposes the
layered-draft helpers — `getActive*Draft`, `update*Draft`,
`createNewLayerDraft`, etc. Touch story state *through these helpers*, not
by hand-splicing the object.

**The AI "brain" is `lib/prompt.ts` + `lib/contextBuilder.ts`.** Treat
them like a design system — they ARE the product:
- `prompt.ts` — system prompt (`SYSTEM_BRAIN`), the `ActionType` union,
  `modelForAction` (three-tier routing), and the live `PRICING` table.
- `contextBuilder.ts` — assembles the minimum viable prompt per action
  and marks stable blocks cacheable. This is why heavy use stays cheap.

**Every AI text call flows through `app/api/generate/route.ts`** — a
streaming endpoint, beta-gated, with token + cost logging. Orchestrated
multi-step flows (e.g. TV import) live in `lib/syncLayer.ts`.

**Layered drafts, the data shape that bites:** TV episodes are canonical
in `Story.episodesDrafts[].episodes[].beats` (the **Episodes layer**).
`StoryLayerDraft.episodes` is a **legacy back-compat field** — empty for
any project newer than the layered-drafts refactor. Always read/write
episodes via `getActiveEpisodesDraft` / `updateEpisodesDraft`. (This
exact confusion has caused real "empty pilot / wrong error" bugs.)

---

## Code map (the files that matter)

| Path | Role |
|---|---|
| `lib/story.ts` | `Story` type + all layer/draft helpers. Start here. |
| `lib/prompt.ts` | System brain, action types, model routing, pricing. |
| `lib/contextBuilder.ts` | Per-action prompt assembly + caching. |
| `lib/syncLayer.ts` | Multi-step AI orchestrators (TV import, layer syncs). |
| `lib/storage.ts` | Supabase load/save + `normalize*` migrations. |
| `lib/prefs.ts` | localStorage prefs (dark mode, image model, etc.). |
| `app/page.tsx` | Home: projects/ideas lists, settings, top-level state. |
| `components/Studio.tsx` | The project editor — **huge**; every tab lives here. |
| `app/globals.css` | All CSS, incl. the v2 design-token definitions. |
| `app/api/generate/route.ts` | The single streaming AI text endpoint. |
| `app/api/generate-*-image/route.ts` | Image gen (character/scene/episode/thumbnail). |

---

## Conventions

- **Design tokens, never literals.** Use `--ds-color-*` and `.ds-type-*`
  (defined in `globals.css`, documented in `docs/v2-design-system.md`).
  Every text element should reference a `.ds-type-*` token. v2 tokens
  only apply under `<html data-design="v2">`.
- **One desktop breakpoint: `@media (min-width: 1440px)`.** Mobile is the
  default; desktop overrides layer on top. When editing desktop CSS,
  remember the cascade — a later rule outside the media block can beat it.
- **Three-tier model routing** (`modelForAction`):
  `claude-opus-4-5` = screenplay prose only (the artifact the user reads);
  `claude-sonnet-4-5` = structure/long-source reasoning;
  `claude-haiku-4-5` = mechanical/single-field. Don't promote an action a
  tier without reason — Opus is ~5× Sonnet, Sonnet ~4× Haiku.
- **Images:** DALL·E 3 is the default; `gpt-image-2` ("Premium Image
  Quality" toggle, ~5× cost) only when the client explicitly sends
  `model: "gpt-image-2"`. There's a global kill-switch pref that disables
  auto image-gen entirely — respect it.
- **Access gates:** beta = `isBetaAllowed` (`NEXT_PUBLIC_ALLOWED_EMAILS`);
  admin endpoints/tools = `isAdmin` (`lib/adminEmails.ts` allowlist).

---

## Gotchas (full list in ONBOARDING "Critical patterns")

- **Vercel serverless kills pending async on response.** `await` every
  side effect (DB writes, storage uploads) inside a route before
  returning — don't fire-and-forget the durable ones.
- **Image-gen in-flight protection:** routes stamp `imageGenAttempted`
  *before* the slow call to survive a mid-gen refresh, and clear it on
  *transient* failure so the next session retries. Don't clear it on
  terminal errors (content policy, billing) or you'll burn quota in a loop.
- **Autosave is debounced** — large inline payloads can race a refresh.
  Server-side persists (`lib/projectImagePersist.ts`) close that window.
- **`setStory` updaters must be pure** and read fresh state via the
  passed `s`, not a captured closure variable.

---

## Cost discipline

This is a beta paid out-of-pocket. Before adding or changing an AI path,
ask: cheapest model that works? cache the stable context? is image-gen
necessary or can a placeholder serve? There's an admin-only **test mode**
for the TV import (1 of each + skip concept) so the full pipeline can be
smoke-tested for cents — use it when validating that flow.

---

## Docs index

- `ONBOARDING.md` — full architecture, UX, data model, DB schema, common tasks.
- `PRINCIPLES.md` — the screenwriting philosophy (Corey Mandell framework).
- `docs/v2-design-system.md` — the token system.
- `docs/screenplay-format-plan.md` — Final-Draft-parity export plan.
- `README.md` — short technical orientation + the economics thesis.
