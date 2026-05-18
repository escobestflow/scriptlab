// Usage logging — server-side helper that inserts one row into
// public.usage_log per AI provider call. Called from every API
// route that touches Anthropic or OpenAI.
//
// Failures inside the logger MUST NOT break the calling route. The
// log is observability, not a hard dependency — if the insert
// fails (DB unreachable, schema drift, etc.) we console.warn and
// move on. The user still gets their generation.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PRICING as TEXT_PRICING } from "@/lib/prompt";

// ── Image + audio pricing (per call) ──────────────────────────
// Sources: openai.com/api/pricing
//   - dall-e-3 standard 1024×1024:   $0.040
//   - dall-e-3 standard 1024×1792:   $0.080
//   - dall-e-3 standard 1792×1024:   $0.080
//   - dall-e-3 hd       1024×1024:   $0.080
//   - dall-e-3 hd       1024×1792:   $0.120
//   - gpt-image-1   medium 1024×1024:$0.040 (current beta rate)
//   - gpt-4o-mini-tts:               $0.015 per 1k characters
//
// We default to "standard" tier for dall-e-3 because that's what
// the app currently requests in /api/generate-*-image. If we
// ever switch to HD, update the rate here AND in the call sites.
const IMAGE_PRICING: Record<string, Record<string, number>> = {
  "dall-e-3": {
    "1024x1024": 0.040,
    "1024x1792": 0.080,
    "1792x1024": 0.080,
  },
  // gpt-image-2 is the SOTA model the v2 cohort uses. ~$0.19 per image
  // at high quality (per the comment in generate-thumbnail/route.ts).
  // If OpenAI publishes a per-size price tier later, expand this map.
  "gpt-image-2": {
    "1024x1024": 0.190,
    "1024x1536": 0.190,
    "1536x1024": 0.190,
    "1536x768":  0.190,
    "768x1536":  0.190,
  },
};

// TTS pricing — per character, scaled from the "$X per 1k chars" rate.
const TTS_PRICE_PER_CHAR: Record<string, number> = {
  "gpt-4o-mini-tts": 0.000015,
};

/** Public input shape for the helper. One of the per-kind blocks is
 *  expected to be populated depending on `kind`. */
export type UsageEvent = {
  userEmail: string | null | undefined;
  /** Optional. Resolved server-side from email when not provided. */
  userId?: string | null;
  projectId?: string | null;

  provider: "anthropic" | "openai";
  kind: "text" | "image" | "audio";
  model: string;

  /** Semantic action — uses the same vocabulary as `lib/prompt.ts`
   *  ActionType for text calls, or a short kebab-case label for
   *  image/audio (e.g. "generate_character_image", "tts"). */
  action: string;

  /** Text-call usage block (Anthropic). Populate for kind: "text". */
  textUsage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };

  /** Image-call params. Populate for kind: "image". `count` defaults
   *  to 1; `size` defaults to "1024x1024". */
  image?: {
    count?: number;
    size?: string;
  };

  /** Audio-call params. Populate for kind: "audio". `chars` is the
   *  length of the text being synthesized. */
  audio?: {
    chars: number;
  };

  /** Populate when the upstream call failed. The row still gets
   *  inserted so failures show up in the dashboard. Cost will be
   *  computed from any partial usage info that came back, or 0. */
  error?: string | null;
};

/** Estimate cost in USD for a usage event. Returns 0 when we don't
 *  have a price for the model — better than a missing row, and the
 *  dashboard's "unknown model" filter surfaces these for review. */
function estimateCostUsd(event: UsageEvent): number {
  if (event.kind === "text") {
    const p = TEXT_PRICING[event.model];
    if (!p) return 0;
    const u = event.textUsage ?? {};
    const input  = (u.input_tokens ?? 0)                * p.input      / 1_000_000;
    const output = (u.output_tokens ?? 0)               * p.output     / 1_000_000;
    const cWrite = (u.cache_creation_input_tokens ?? 0) * p.cacheWrite / 1_000_000;
    const cRead  = (u.cache_read_input_tokens ?? 0)     * p.cacheRead  / 1_000_000;
    return input + output + cWrite + cRead;
  }
  if (event.kind === "image") {
    const sizeMap = IMAGE_PRICING[event.model];
    if (!sizeMap) return 0;
    const size = event.image?.size ?? "1024x1024";
    const perImage = sizeMap[size] ?? sizeMap["1024x1024"] ?? 0;
    const count = event.image?.count ?? 1;
    return perImage * count;
  }
  if (event.kind === "audio") {
    const perChar = TTS_PRICE_PER_CHAR[event.model] ?? 0;
    return perChar * (event.audio?.chars ?? 0);
  }
  return 0;
}

/** Fire-and-forget insert. Never throws — failures are logged to the
 *  server console only. Returns the inserted row's id when the insert
 *  succeeds, or null when it didn't run (no admin client or no email). */
export async function logUsage(event: UsageEvent): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return null;
    if (!event.userEmail) return null;

    // Resolve user_id from email if the caller didn't pass it in.
    // The Supabase admin API doesn't expose `getUserByEmail` directly
    // on all versions; the cleanest stable path is a single
    // `auth.admin.listUsers` filtered to the email. Cached per
    // process via the closure below.
    let userId = event.userId ?? null;
    if (!userId) {
      userId = await resolveUserId(event.userEmail);
    }

    const est_cost_usd = estimateCostUsd(event);

    const row = {
      user_id: userId,
      user_email: event.userEmail,
      project_id: event.projectId ?? null,
      provider: event.provider,
      kind: event.kind,
      model: event.model,
      action: event.action,

      input_tokens:                event.textUsage?.input_tokens                ?? null,
      output_tokens:               event.textUsage?.output_tokens               ?? null,
      cache_creation_input_tokens: event.textUsage?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens:     event.textUsage?.cache_read_input_tokens     ?? null,

      image_count: event.image?.count ?? null,
      image_size:  event.image?.size  ?? null,

      audio_chars: event.audio?.chars ?? null,

      est_cost_usd: Number(est_cost_usd.toFixed(6)),
      error: event.error ?? null,
    };

    const { data, error } = await admin
      .from("usage_log")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.warn("[usageLog] insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[usageLog] unexpected:", msg);
    return null;
  }
}

// ── Internal: email → user_id resolution with a tiny LRU cache ──
// Resolving on every request would double the DB roundtrip; cache
// by email for the process lifetime. The cache is bounded to 100
// emails (well above the beta cohort size) — old entries are
// dropped FIFO when full.
const userIdCache = new Map<string, string>();

async function resolveUserId(email: string): Promise<string | null> {
  const key = email.toLowerCase();
  const hit = userIdCache.get(key);
  if (hit) return hit;

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  try {
    // listUsers returns { users: User[] } in v2 of @supabase/supabase-js.
    // Pass a perPage of 1000 so the entire beta cohort fits in one call.
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) {
      console.warn("[usageLog] listUsers failed:", error.message);
      return null;
    }
    const found = data?.users.find(u => (u.email ?? "").toLowerCase() === key);
    if (!found) return null;

    if (userIdCache.size >= 100) {
      const firstKey = userIdCache.keys().next().value;
      if (firstKey) userIdCache.delete(firstKey);
    }
    userIdCache.set(key, found.id);
    return found.id;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[usageLog] resolveUserId threw:", msg);
    return null;
  }
}

// Admin / trusted-email gates live in lib/adminEmails.ts (no Supabase
// deps) so the dashboard's client component can import them too.
export { isAdmin, isTrusted } from "@/lib/adminEmails";
