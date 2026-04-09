# ScriptWriter POC

Iterative screenwriting app powered by Claude. Proves out the economics of heavy, iterative AI use through **prompt caching**, **model routing**, and **structured story state**.

## What's inside

- **`lib/story.ts`** — the structured Story JSON. Single source of truth. UI edits this; AI reads/writes this.
- **`lib/prompt.ts`** — the screenwriting "brain" (system prompt) + model routing + live pricing table. **Iterate on this file like a design system — it's the product.**
- **`lib/contextBuilder.ts`** — assembles the minimum viable prompt per action and marks stable blocks as cacheable. This is why heavy usage stays cheap.
- **`app/api/generate/route.ts`** — streaming Claude endpoint with token + cost logging.
- **`app/page.tsx`** — minimal 3-pane UI: settings/ingredients, actions/output, live cost meter.

## Setup (one time)

1. **Get an API key**
   - Go to https://console.anthropic.com
   - Sign up, add $5 of credit, set a monthly spending cap (Settings → Limits)
   - Create an API key (keep it secret)

2. **Save the key locally**
   ```
   cp .env.local.example .env.local
   ```
   Open `.env.local` and paste your key after `ANTHROPIC_API_KEY=`.

3. **Run it**
   ```
   npm run dev
   ```
   Open http://localhost:3000

## What to try (the POC goal)

1. Click **Generate beat sheet** — watch the right panel. First call writes to cache (`wrote N`).
2. Change a slider (unpredictability, darkness) — click **Generate beat sheet** again. Second call should show `cached N` (green), ~10% input cost.
3. Click **Swap** on an ingredient. Tiny, fast call on Haiku.
4. Click **Add twist**, **Brainstorm**. Iterate freely.
5. Watch the **Live cost meter**. After 20 iterations you should be well under $0.20 total.

If the cache hit rate is high and the meter stays low — the heavy-usage economic model works, and the app is safe to scale up.

## Model routing

Defined in `lib/prompt.ts` → `modelForAction`:
- **Haiku 4.5**: structure, swaps, twists, brainstorms (fast + cheap)
- **Sonnet 4.5**: scene prose, beat rewrites (quality matters)

Change it freely.

## What's not in the POC (on purpose)

- No database — story lives in React state. Add Supabase next.
- No auth — single-user local. Add Supabase Auth next.
- No voice-to-text — Web Speech API plug-in next.
- No RAG on snippets — add pgvector next when you have 50+ snippets.
- No per-user rate limits — irrelevant locally.

These are all deliberate. The POC exists to prove the **economics + iterative feel**. Once that's validated, each of those is an afternoon's work to add.

## Iterating on the brain

Open `lib/prompt.ts`. The `SYSTEM_BRAIN` string IS the product. Rewrite it like a brief. Add frameworks, add constraints, add voice. Reload the page — no rebuild needed in dev.
