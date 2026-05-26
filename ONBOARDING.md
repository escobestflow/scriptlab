# Unfold — App Guide

This document is in two parts. The first part is the human story of what
Unfold is and how it feels to use it. The second part is the technical
manual: how the app is built, where everything lives, and the patterns
to understand before changing anything. Both parts are intentionally
detailed.

---

# Part 1 — What Unfold is (purpose, flow, UX)

## The vision

Unfold is a space where screenwriters and storytellers go from a spark
of an idea to a polished screenplay without the friction of facing a
blank page. AI is woven through every step — drafting concepts,
imagining characters, breaking story into scenes, writing prose — but
the writer always stays in creative control. The app's job is to take
care of the structural scaffolding so writing can stay creative.

It's a tool for screenwriters, working writers, filmmakers, and anyone
who has an idea for a story and wants to see what it could become
without having to first learn how to format a screenplay or outline a
season of television.

## The core philosophy

Writing is iterative. Most software treats a story as a single object
that you edit until it's "done." Unfold treats every version as a real,
savable thing. Your second draft of a concept doesn't overwrite the
first — it lives alongside it. You can branch the story but keep the
script, swap characters between versions, jump back to a beat you
abandoned three weeks ago. Drafts are first-class citizens.

The other principle: AI is an editor in the room, not a slot machine.
When you ask the app to help, it always has the full context of your
project — your concept, your characters, your prior drafts — so the
suggestions read like a thoughtful collaborator filling in gaps, not
a stranger guessing at your story.

## The main flow

When you sign in (Google), you land on the **Projects** tab. Each
project is a card with its cover art, title, draft number, and genre
chips. Tapping one drops you into the **Studio** — the heart of the
app, where everything for that project lives.

The Studio is built around **layers**:

- **Concept** — the foundation. Title, format (Feature / Short / TV
  Show), logline, summary, genre, tone, themes, structure, ending
  type, pacing dials, similar films / shows, writer styles to echo.
  Everything else is built on top of this.
- **Characters** — the cast. Each character has a portrait,
  backstory, want, need, flaw, motivations, arc, voice. AI-generated
  by default; manually editable.
- **Story** — the scene-by-scene outline. Beats with names,
  summaries, purposes, durations, locations, time of day, and which
  characters appear. Drag to reorder. For features: a single
  continuous beat list. For shorts: typically 6–10 beats.
- **Script** — the prose. Each beat becomes a screenplay scene with
  slugline, action, and dialogue. Generated layer-by-layer or all at
  once.
- **Episodes** — TV only. A separate layer that holds a list of
  episodes, each of which has its own Story and Script. (More on TV
  below.)

Each layer has its own pool of **drafts**. When you sync from
Concept → Characters, the new Characters become a new draft of the
Characters layer — your previous Characters draft is still there.
You can also save explicit drafts at any time and switch back to
them later. A **Project Draft** is a named combination of one
draft from each layer; that's how the app keeps a coherent version
of "what the story is right now" while letting you branch any
single layer without losing the whole thing.

## Format-specific flows

**Feature films & short films** show four tabs in the Studio:
Concept · Characters · Story · Script. Linear and straightforward.

**TV Series** introduces a two-level hierarchy:

1. At the project level, three tabs: **Concept · Episodes ·
   Characters**. Concept and Characters are global to the series.
   Episodes is the new tab — a grid of episode cards.
2. Each episode card drills down one level. Inside an episode, you
   see only **Story · Script** — the per-episode breakdown. The
   project hero stays visible at the top (so you always know which
   show you're inside), with the episode title rendered just beneath
   the project title. A "Back to Episodes" chip returns you to the
   series-level view on desktop; on mobile the standard top-left
   back arrow handles it.

## How AI shows up

AI is everywhere but never imposed. Three patterns recur:

- **Easy Mode** — one tap on a fresh project. AI writes a concept,
  cast, beat-by-beat outline, and first-pass script from just the
  title, format, and genre. The writer can then edit anything.
- **Update Other Layers** — visible at the top of every tab. If you
  edit your concept, the button on the Characters tab offers to
  re-derive characters from the new concept. Same for Story and
  Script. It always runs as a new draft so nothing is destroyed.
- **Create With AI** buttons — scattered on empty states and
  field-level lightning-bolts. The Concept tab has them on individual
  fields (Logline, Summary, Tone…). The Story tab's "Create with AI"
  opens a popup asking for optional direction before generating. The
  Episodes tab has the same — the description you type becomes the
  new episode's logline and seeds the per-episode story when AI is
  used.

Everything an AI generates is grounded in the project context the user
has already filled in. The writer doesn't have to "ask" — the tool
already knows.

## Ideas

Separate from Projects, there's an **Ideas** tab. It's a fast-capture
journal for fragments — a character name you overheard, a snippet of
dialogue, a memory you want to hold onto. Each idea is tagged by
type: Situation, Conversation, Memory, Joke, Scene, Dialogue,
Character, Image, Dream, Note. Search and filter as the journal grows.

Ideas aren't tied to any one project — they're a personal pool you can
draw from when starting something new. Future versions will let you
import ideas directly into a project's concept or beat list.

## Collaboration

A project can be shared with one other person. Both writers see the
same project with their own drafts pool alongside their partner's;
you can peek at their drafts, copy one in, or work in parallel and
merge later. Each collaborator has their own row in the database —
deleting your copy of the project doesn't affect theirs.

## Settings, preferences, and chrome

The user's Settings screen lets them toggle:
- Dark Mode
- Draft Popups (popup vs sheet treatment for the draft picker)
- Auto-Save Edits
- Empty State Preview (a dev flag for re-showing the empty graphic)
- AI Connections (placeholder for future provider settings)
- Styleguide (opens the design-system reference page)

Project-level settings live behind the gear icon on the hero — title,
format, cover regeneration, sharing, exporting, deletion.

## The design language

The current design ("v2") is a serif/sans pairing — **Poynter Oldstyle
Display** for headings and project names, **Lato** for body and UI.
The palette is warm: paper-cream backgrounds, near-black ink, an
"unfold gold" used as the only accent (gold rule under project titles,
gold timestamps, gold layer dividers).

On mobile, everything lives in a single-column 520-px-wide phone
canvas: full-bleed hero image, sticky title + drafts row, sticky tab
bar, vertically stacked content. On desktop (≥1440px), the same
content reflows into a sidebar + two-column content view: persistent
left nav, hero image on the left of the project page with the meta
column on the right, two-column grid on the Concept tab, four-column
grid on the Episodes tab, list-+-detail layout on the Script tab.

Cards everywhere. Soft 9%-opacity shadows for elevation. A single
elevation token (`--ds-shadow-card`) is reused on every card surface
so depth reads consistently across the app.

---

# Part 2 — Technical setup (architecture + code map)

This section is for an engineer (or another AI) picking up the
codebase. It explains the stack, the data model, the patterns to
follow, the gotchas to avoid, and where every important piece of code
lives.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14.2.15 (App Router) |
| Language | TypeScript (strict) |
| Runtime | Node.js on Vercel serverless |
| Database | Supabase (Postgres + Auth + Storage) |
| Auth | Supabase Auth with Google OAuth |
| AI — text | Anthropic SDK (Claude Haiku 4.5, Sonnet 4.5) |
| AI — images | OpenAI SDK (gpt-image-2 for v2 users, dall-e-3 for v1) |
| AI — audio | OpenAI gpt-4o-mini-tts |
| Email | Resend (invite + share emails) |
| Hosting | Vercel (production = main branch) |
| Styling | Plain CSS in `app/globals.css` (no Tailwind) |

## Repo layout

```
/app
  /api                       Server-side route handlers
    /admin/                   Admin-only endpoints (gated by adminEmails allowlist)
    /generate                 Anthropic text gen (streaming NDJSON)
    /generate-character-image OpenAI image gen for characters
    /generate-scene-image     OpenAI image gen for beats
    /generate-thumbnail       Project cover (Haiku prompt build + OpenAI image)
    /convert-notes            Sonnet-based notes-to-beats conversion
    /tts                      Audio read-through generation
    /send-email               Resend invite/share emails
    /migrate-image-thumbnail  Background base64 → Storage URL migration
  /admin/usage                Admin usage dashboard (v2 design)
  /accept-invite/[code]       Collaborator accept flow
  /dev-login                  Dev shortcut (email/password)
  /style-guide                Design system reference page
  /                           Main app: Projects, Ideas, Studio, Settings
  globals.css                 Design tokens + every component style (~13K lines)
  layout.tsx                  Root layout

/components
  Studio.tsx                  The studio shell (~12K lines) — every tab lives here
  DesktopSidebar.tsx          Shared sidebar (used by / and /admin/usage)
  EasyModeOverlay.tsx         Easy-mode progress overlay
  PostLoginTransition.tsx     Splash → app transition
  SplashLoader.tsx            Splash screen
  ui.tsx                      Button, Input, Textarea, Selector, Tip

/lib
  story.ts                    Story type + every draft helper (~2K lines)
  storage.ts                  Supabase CRUD + normalize/migrate
  contextBuilder.ts           Prompt builders for each ActionType
  prompt.ts                   ActionType registry + model routing
  syncLayer.ts                Cross-layer sync (Concept → Characters etc.)
  scriptLoop.ts               Script-generation loop (one beat at a time)
  easyMode.ts                 Concept → Script one-touch pipeline
  imageGenWithFallback.ts     gpt-image-2 → dall-e-3 fallback
  imageStorage.ts             Storage uploads (random UUID filenames)
  projectImagePersist.ts      Server-side write of generated URLs into project row
  usageLog.ts                 Usage logging (writes to usage_log table)
  adminEmails.ts              Admin allowlist (currently just luisfescobarjr@gmail.com)
  v2Access.ts                 V2 design + v2-model allowlist (NEXT_PUBLIC_V2_EMAILS)
  betaAccess.ts               Beta cohort allowlist (NEXT_PUBLIC_ALLOWED_EMAILS)
  pricing.ts                  Cost-estimation rates per model
  supabase.ts                 Browser Supabase client
  supabaseAdmin.ts            Service-role Supabase client (server only)
  auth.tsx                    useAuth() hook
  prefs.ts                    useDarkModePref / useAutosavePref / useDraftPickerStylePref
  writerProfileStore.tsx      Writer-profile context + persistence
  invites.ts                  Collab invite RPCs
  sampleData.ts               Moment type
  references.ts               Reference aspects (writer styles, tones, etc.)

/public                       Static assets (logos, icons, hero graphics)
  /v2/                        v2-specific icons + empty-state graphics
  icon-episodes.svg           Episodes tab glyph
  add-icon.svg                Default add icon (v1 mobile)
  icon-desktop-button-add.svg Add icon for desktop CTAs

/supabase                     SQL migrations + seed scripts (NOT auto-applied)
  usage-log.sql               usage_log table + ALTER TABLE additions
  beta-allowlist.sql          Beta cohort seed
  collab-*.sql                Collaboration RPCs + RLS policies
```

## Data model (top-level types)

Source of truth: `lib/story.ts`. Everything else either reads or
patches one of these.

```ts
type ProjectType = "feature" | "short" | "tv-show";

interface Story {
  id: string;
  title: string;
  projectType: ProjectType;
  thumbnail?: string;
  thumbnailPromptExtra?: string;
  conceptDrafts: ConceptLayerDraft[];
  charactersDrafts: CharactersLayerDraft[];
  storyDrafts: StoryLayerDraft[];
  scriptDrafts: ScriptLayerDraft[];
  episodesDrafts?: EpisodesLayerDraft[];      // TV-only
  projectDrafts: ProjectDraft[];
  activeProjectDraftId: string;
  counters: { concept; characters; story; script; project; episodes? };
  updatedAt: string;
  collaboratorUserId?: string;                 // truthy = shared project
}

interface ProjectDraft {
  id; number; createdAt; updatedAt; savedAt;
  conceptDraftId; charactersDraftId; storyDraftId; scriptDraftId;
  episodesDraftId?;                            // TV-only
  savedConceptDraftId?; savedCharactersDraftId?; …;
  conceptSyncedAt?; charactersSyncedAt?; storySyncedAt?; episodesSyncedAt?;
}
```

A **ProjectDraft** is a 5-field combination pointer. Editing a layer
mutates that layer's draft directly; the ProjectDraft just references
it by id. To branch a layer without losing the original, the app
creates a new layer draft and updates the active ProjectDraft's
pointer.

Per-layer drafts:

- `ConceptLayerDraft` — `{ id, number, ts, logline, settings, concept }`
- `CharactersLayerDraft` — `{ id, number, ts, characters: Character[] }`
- `StoryLayerDraft` — `{ id, number, ts, beats: Beat[], ingredients,
  snippets, direction? }`
- `ScriptLayerDraft` — `{ id, number, ts, script: { scenes, syncStatus,
  lastSyncedAt? } }`
- `EpisodesLayerDraft` — `{ id, number, ts, episodes: Episode[] }`

`Beat`, `Character`, `Episode`, `Scene` are detailed types — see
`lib/story.ts` for the full shape.

## Storage layer (`lib/storage.ts`)

Single source of truth for talking to Supabase Postgres.

- `saveProjectToDB(userId, project)` — upserts `projects` table row.
- `loadProjectsFromDB(userId)` → `Story[]` — loads + normalizes.
- `deleteProjectFromDB(projectId, userId)` — deletes user's own row
  (partner's stays).
- `loadPartnerProjectData(projectId, partnerUserId)` — for collab.
- `loadMomentsFromDB(userId)` / `saveMomentToDB` / `deleteMomentFromDB`.

The critical function is **`normalizeStory(s: any)`** which handles
three legacy schema shapes:

1. **Layered** (current): `conceptDrafts[]`, `projectDrafts[]`, etc.
   Already in the new shape.
2. **Monolithic** (one iteration ago): a single `drafts[]` array
   where each entry has all four layers baked in. Split into separate
   layer-draft arrays + a parallel ProjectDraft for each.
3. **Single legacy** (oldest): top-level content fields. Wrap into
   one of each layer draft + one ProjectDraft.

The normalizer also handles the TV-episodes migration: legacy TV
projects stored episodes inside `storyDraft.episodes`. On load, those
episodes are lifted to a parallel `EpisodesLayerDraft[]`, and each
ProjectDraft's `episodesDraftId` is computed via a
`storyDraftId → episodesDraftId` lookup. No data loss; the
`StoryLayerDraft.episodes` field stays declared (deprecated) so
back-compat reads don't crash.

## Auth + access control

Three allowlists, each gated by an env var:

| List | Env var | What it gates |
|---|---|---|
| Beta cohort | `NEXT_PUBLIC_ALLOWED_EMAILS` | Sign-up access |
| V2 design + paid features | `NEXT_PUBLIC_V2_EMAILS` | v2 UI + gpt-image-2 |
| Admin | hardcoded in `lib/adminEmails.ts` | Admin endpoints + dashboard |

Beta and V2 lists are `NEXT_PUBLIC_` so they're shipped to the
browser; the gating is UX-level (the actual security gate is the
beta-allowlist RLS policy in Postgres). Admin list is hardcoded
because there's only one admin (the developer) and we don't want it
in the client bundle.

Service-role Supabase client (`lib/supabaseAdmin.ts`) is used
**only** in server contexts — never imported from a client component.
Bypasses RLS. Required for: usage logging, server-side image
persistence, admin endpoints, partner-row mutations.

## Routes (App Router)

| Route | Purpose |
|---|---|
| `/` | Main app — Projects / Ideas / Studio / Settings |
| `/admin/usage` | Usage dashboard (admin-only) |
| `/accept-invite/[code]` | Collaborator accepts an invite |
| `/dev-login` | Email/password shortcut for dev |
| `/style-guide` | Design system reference |

API routes (all server-side):

| Route | What it does |
|---|---|
| `POST /api/generate` | Anthropic text gen, streaming NDJSON. The single endpoint behind every text action (generate_concept, generate_characters, sync_concept_to_story, etc.). |
| `POST /api/generate-character-image` | OpenAI character portrait. Uploads to `character-images` Storage bucket, persists URL into project row. |
| `POST /api/generate-scene-image` | Same pattern for beats; `scene-images` bucket. |
| `POST /api/generate-thumbnail` | Project cover. Two-stage: Haiku composes the prompt, then OpenAI generates. URL goes into `projects.thumbnail` column. |
| `POST /api/tts` | gpt-4o-mini-tts for the read-through feature. |
| `POST /api/convert-notes` | Free-text notes → structured beat list (Sonnet). |
| `POST /api/send-email` | Resend wrapper for invites + share emails. |
| `POST /api/migrate-image-thumbnail` | One-shot upload of inline-base64 character/beat thumbnails into Storage. |
| `GET /api/admin/usage` | Returns last-30-days rows from `usage_log`. |
| `GET /api/admin/list-projects` | Diagnostic: lists every `projects` row. |
| `GET/POST /api/admin/reset-stuck-images` | Clears `imageGenAttempted` on stuck characters/beats. |
| `POST /api/admin/cleanup-orphan-thumbnails` | Removes Storage objects that aren't referenced by any project. |

### How the AI calls flow

**Text generation** (`/api/generate`):
1. Client posts `{ story, action, profile }` where `action` is an
   `ActionRequest` (type discriminated union — see `lib/prompt.ts`).
2. Server picks the model via `routeAction(action.type)` (Haiku for
   light tasks like `detect_character_gender`; Sonnet for heavy
   structural work like `sync_concept_to_script`).
3. Server builds the prompt via `contextBuilder.ts`. The prompt
   always carries the FULL story context — concept fields, character
   list, beats, etc. — so the model never has to guess.
4. Server streams response as NDJSON; client parses incrementally
   and applies via `applySyncResult()` in `lib/story.ts`.
5. After the stream completes, server writes to `usage_log` with
   input/output tokens.

**Image generation** (`/api/generate-character-image` etc.):
1. Client posts `{ description, genre, tone, projectId, characterId, …display metadata }`.
2. Server immediately calls `markCharacterAttempted(projectId,
   characterId)` to set the `imageGenAttempted` sentinel on the
   character row (prevents re-fires on client refresh).
3. Server picks model: v2 users get gpt-image-2, falls back to
   dall-e-3 on any failure (see `lib/imageGenWithFallback.ts`).
4. Server compresses output to JPEG and uploads to the relevant
   Supabase Storage bucket via `uploadJpegToStorage()`.
5. Server calls `setCharacterThumbnail(projectId, characterId, url)`
   to write the URL directly into the character's record in the
   project's `data` JSONB. **This is awaited** — see "Gotchas" below.
6. Server returns `{ thumbnail }` to the client which also updates
   local React state.

The mark-attempted + persist-on-completion pattern is what makes the
flow survive a client navigation mid-generation. The URL is in the
row by the time the response comes back; if the client closed its
tab, the next page load picks up the new thumbnail.

## Usage logging

Every AI call writes one row to `public.usage_log` via
`lib/usageLog.ts`. The shape:

```ts
{
  user_id, user_email,
  project_id, project_name,
  target_id, target_name,           // character.id / beat.id + name
  draft_id, draft_label,            // active layer-draft snapshot
  provider, kind, model, action,
  input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
  image_count, image_size,
  audio_chars,
  est_cost_usd,                     // computed via lib/pricing.ts
  error,                            // populated on failure
  created_at
}
```

Reads happen via `/api/admin/usage` (admin-gated). The dashboard at
`/admin/usage` renders KPIs, by-user, by-action, daily timeline,
suspected duplicates (same project + target + draft generated more
than once), and a recent-calls table.

## Design system

CSS variables and type tokens live at the top of `app/globals.css`.
Two design generations coexist:

- **v1** is the legacy mobile-first design. No prefix; default rules.
- **v2** is the current design. Every rule is scoped to
  `html[data-design="v2"]` so v1 users see the old design unchanged.

The `data-design` attribute is set by the root layout based on
`isV2User(user?.email)`.

### Color tokens

`--ds-color-black`, `--ds-color-white`, `--ds-color-unfold-gold`,
`--ds-color-app-background`, `--ds-color-gray-*` (eight gray
swatches for different surface roles), `--ds-color-accent-*-on-dark
/ -on-light` (six accent pairs for badges and chips).

### Shadow token

`--ds-shadow-card: 0 2px 16px 0 rgba(0,0,0,0.09)`. The canonical
card elevation; reused on Idea cards, Project covers, Episode cards,
the back-to-episodes chip, the desktop settings FAB.

### Type tokens

CSS utility classes that bundle font-family + size + weight + line-
height + letter-spacing for a specific role:

- `.ds-type-tab-header` — page-level headings (Projects, Ideas)
- `.ds-type-project-page-title` — project name in hero
- `.ds-type-project-page-title-empty` — empty-state hero title variant
- `.ds-type-project-card-title` — card titles, episode title
- `.ds-type-empty-header` — empty-state titles
- `.ds-type-body` — base body copy
- `.ds-type-body-sm` — smaller body
- `.ds-type-body-bold` — emphasized body
- `.ds-type-cta` — uppercase Lato Medium for buttons (9px mobile / 11px desktop)
- `.ds-type-draft-dropdown` — the draft picker pill label
- `.ds-type-project-tab-nav-active` / `.ds-type-project-tab-nav-inactive` — tab labels

Each token has a mobile baseline and a desktop override inside
`@media (min-width: 1440px)`.

### Responsive breakpoint

Single breakpoint at **1440px**. Everything below is treated as
mobile (assumes phone); 1440+ gets the full desktop layout. There's
no tablet-specific treatment.

## Component patterns

### Studio.tsx (the big one)

A ~12,000-line component holding the entire project-detail surface.
Structure:

- **State + hooks** at the top (project, section, drafts, in-flight
  sets, sheets, popups…).
- **Top-level effects** for auto-fill (character/scene images),
  background thumbnail migration, sync state, scroll behavior.
- **Helper functions** for character/scene actions.
- **Render** that branches by `section` and conditionally on
  `isTV && activeEpisodeId`.
- **Tab components** (`ConceptTab`, `CharactersTab`, `EpisodesTab`,
  `StoryTab`, `ScriptTab`) defined as inline functions further down.
- **Shared editor components** (`CharacterEditForm`, `BeatSheet`,
  `SettingsTab`, `LayerBar`, `LayerDraftPicker`, `EmptyLayerState`,
  `SectionTabs`).

The big file is intentional — most edits touch multiple tabs that
share state, so splitting into separate files would force a lot of
prop-drilling. Long-term we'd want to split, but only after deciding
on a state-sharing pattern (Context, Zustand, etc.) that doesn't
hurt the existing readability.

### LayerBar

Renders at the top of each tab. Contains the LayerDraftPicker plus
an optional right-slot for inline CTAs (Add chips, Generate buttons).
Shared chrome for all five layer tabs.

### LayerDraftPicker

Dropdown for switching drafts within a layer. Lists drafts from
`getLayerPool(story, layer)`. On collab projects, prompts "Whose
drafts?" first.

### EmptyLayerState

Shared empty-state shell. Takes `icon`, `title`, `caption`,
`addLabel`, `onAdd`, `onGenerate`, `generateLabel`, plus optional
v2 props (`section`, `layer`, `draftPickerLabel`, `story`,
`setStory`) for the v2 overlay treatment. The v2 path renders a
specific silhouette graphic per `data-section`.

### SectionTabs

The tab bar above the content. Renders a conditional list:

- Feature/Short: `[Concept, Characters, Story, Script]`
- TV at project level: `[Concept, Episodes, Characters]`
- TV inside an episode: `[Story, Script]`

The active tab gets a sliding gold underline (desktop only) driven
by a `useLayoutEffect` that reads the active tab's position and
writes `--underline-x` and `--underline-w` CSS variables.

### Auto-fill effects (image generation)

`autoGenerateCharacterImage(characterId)` and
`autoGenerateSceneImage(beatId)` fire from a `useEffect` watching
`[story]`. They iterate over the active draft, find items with a
name but no thumbnail, and trigger generation. Protections:

1. `*ImagesInFlight` ref — prevents same-tick re-entry.
2. `*ImagesFailed` ref — prevents retry after a session-level
   failure.
3. `ch.thumbnail` / `b.thumbnail` — skips if already present.
4. `ch.imageGenAttempted` / `b.imageGenAttempted` — persistent
   sentinel that prevents retries across reloads. Set BEFORE the
   network call goes out.
5. For the create-character / create-scene sheets, the auto-fill
   effect explicitly excludes the item being typed-into (otherwise
   every keystroke fires a partial gen).

## Critical patterns + gotchas

### Vercel serverless: await all side effects

After `return new Response(...)`, Vercel may immediately shut down
the function. Any `void someAsyncFn()` after that is at risk of
being killed mid-execution. **Always `await`** for:
- `setCharacterThumbnail` / `setBeatThumbnail` / `setProjectThumbnail`
- `markCharacterAttempted` / `markBeatAttempted`
- Anything else that's load-bearing for the user's data

`logUsage` is the exception — it's observability, not data, and we
accept dropping occasional rows in favor of latency.

### CSS cascade with the desktop @media block

The big `@media (min-width: 1440px)` block sits in the middle of
`globals.css`. Any base (no-media) rules appearing AFTER it in
source order will OVERRIDE the desktop rules on desktop. When
adding base rules, either:
- Place them BEFORE the desktop @media block, OR
- Wrap them in `@media (max-width: 1439px)` to scope to mobile

This bit us with the idea-card grid and the episode-card grid.

### Autosave debouncer

`app/page.tsx` has a 1s debounce on `saveProjectToDB`. If the user
fires a rapid sequence of edits-then-deletes, the autosave can race
with deletes. Server-side persistence (above) is the durable fix
for image generation. For text edits, the race is short-lived and
the eventual-consistency is acceptable.

### React 18 + setStory pattern

All state updates use the function form:
```ts
setStory(s => updateStoryLayerDraft(s, { beats: ... }))
```
Never `setStory(updatedStory)` — that can stale-close over a
previous render's state and silently drop intermediate edits.

### Image gen in-flight protection (the lesson)

The single most expensive bug to track down was credit-bleed from
auto-firing image generations on every refresh. Final pattern:
1. Set `imageGenAttempted=true` in local state BEFORE the fetch.
2. Server immediately persists `imageGenAttempted=true` to Supabase
   (await markCharacterAttempted).
3. Server completes generation.
4. Server immediately persists the resulting URL to Supabase
   (await setCharacterThumbnail).
5. Client updates local state if it's still listening.

Any deviation from this pattern risks repeating the bug.

### TV episodes migration

When the EpisodesLayerDraft schema was introduced, legacy TV
projects stored episodes inside `storyDraft.episodes`. The
normalizer detects this and lifts them. The `StoryLayerDraft.episodes`
field is marked `@deprecated` but still typed so old reads don't
crash. New code should NEVER write to `StoryLayerDraft.episodes` —
use `EpisodesLayerDraft` instead.

## Dev workflow

```bash
# Run locally
npm run dev

# Type-check + build (catches everything tsc would)
npx next build

# Standard commit
git add <files>
git commit -m "<message>

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push

# Deploy to production
npx vercel --prod --yes
```

The user's standing instruction: after `git push`, always run
`npx vercel --prod --yes` in the same turn. They verify on phone
via `script-lab-beta.vercel.app`.

## Database schema (Supabase Postgres)

```sql
-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  collaborator_user_id UUID NULL,
  data JSONB NOT NULL,         -- the Story (minus thumbnail + collaboratorUserId)
  thumbnail TEXT NULL,         -- URL or data URL
  updated_at TIMESTAMPTZ
);

-- Ideas
CREATE TABLE moments (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  data JSONB NOT NULL,         -- the Moment
  created_at TIMESTAMPTZ
);

-- Usage log (admin observability)
CREATE TABLE usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID,
  user_email TEXT,
  project_id UUID,
  project_name TEXT,
  target_id TEXT,
  target_name TEXT,
  draft_id TEXT,
  draft_label TEXT,
  provider TEXT,              -- 'anthropic' | 'openai'
  kind TEXT,                  -- 'text' | 'image' | 'audio'
  model TEXT,
  action TEXT,
  input_tokens INT,
  output_tokens INT,
  cache_creation_input_tokens INT,
  cache_read_input_tokens INT,
  image_count INT,
  image_size TEXT,
  audio_chars INT,
  est_cost_usd NUMERIC,
  error TEXT
);

-- Invites
CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  project_id UUID,
  inviter_user_id UUID,
  ...
);
```

RLS policies enforce that users can only see/edit their own
projects + projects where they're the `collaborator_user_id`.
Storage buckets `character-images`, `scene-images`, and (project
covers via the `thumbnail` column inline) are configured public-read
so the URLs work in `<img>` tags without auth headers.

## Environment variables

| Var | Purpose | Where |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Both browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (RLS-gated) | Browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (bypasses RLS) | Server only — sensitive |
| `ANTHROPIC_API_KEY` | Claude API | Server only |
| `OPENAI_API_KEY` | OpenAI API | Server only |
| `NEXT_PUBLIC_ALLOWED_EMAILS` | Beta cohort allowlist (comma-separated) | Browser |
| `NEXT_PUBLIC_V2_EMAILS` | V2 cohort allowlist | Browser |
| `RESEND_API_KEY` | Resend (email) | Server only |

All set in Vercel project settings (Production environment) and
mirrored in local `.env.local`. The service-role key is marked
"Sensitive" in Vercel, which means `vercel env pull` doesn't return
its value — to use it locally, copy from Supabase dashboard
directly.

## Common tasks

### Add a new AI action (text)

1. Add an entry to `ActionType` in `lib/prompt.ts`.
2. Add a case in `routeAction()` for model choice (Haiku vs Sonnet).
3. Add a case in `lib/contextBuilder.ts` for the prompt builder.
4. Wire client-side: call `run({ type: "your_action", payload })` from
   the relevant tab. The result streams via `applySyncResult`.

### Add a new layer

Big lift. Touches:
- `lib/story.ts`: type, draft factories, getActive*, update*, save*, isLayerDraftEmpty, isLayerChangedForTabDot, createEmptyLayerDraft, createNewLayerDraft, copyPartnerLayerDraft, LayerContent, applySyncResult.
- `lib/storage.ts`: normalize+migrate.
- `components/Studio.tsx`: Section type, tab list, render case, optional sub-component.
- `lib/syncLayer.ts`: if it has sync targets.
- `app/globals.css`: empty-state graphics, draft picker copy, tab icon.

The TV Episodes layer is a worked example of this — diff
`67e7f86` (Episodes addition) against the prior commit to see the
full pattern.

### Add a new design token

1. Declare in the `:root` block at the top of `globals.css` (or in
   `html[data-design="v2"]` if v2-only).
2. Add a utility class if it's typography (e.g. `.ds-type-X`).
3. Use via `var(--ds-X)` or via the class.

### Make an admin endpoint

1. Create `app/api/admin/<name>/route.ts`.
2. Check `isAdmin(req.headers.get("x-user-email"))` at the top;
   return 403 if not admin.
3. Use `getSupabaseAdmin()` for any DB writes.
4. Add a UI hook in `app/admin/usage/page.tsx` if appropriate, or
   leave as a CLI tool (the user invokes from the browser console).

---

## Known follow-ups (Phase 2+)

- **Episode AI generation** — the "Create with AI" episode CTA
  currently uses the same handler as manual; needs a `generate_episode`
  action that produces title + logline + seeded beats from the project's
  concept context.
- **Per-scene character selection** — UI to pick which characters from
  the active Characters draft appear in each scene.
- **TV project-level drafts** — the UI behavior around
  `projectDrafts` on TV shows needs an audit against the new
  hierarchy.
- **Episode cover image generation** — the data-layer fields exist
  (`Episode.thumbnail`, `Episode.imageGenAttempted`) but the
  auto-fill effect analogous to `autoGenerateSceneImage` hasn't been
  written.
- **Usage caps + email alerts** — soft per-user daily caps + Resend
  alerts when a user crosses a threshold.

These are tracked informally; pick whichever is the highest leverage
when continuing the work.
