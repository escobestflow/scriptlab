// Shared image-generation helper used by every /api/generate-*-image
// route. Two motivations for centralizing this:
//
//   1. Fallback. V2 users get gpt-image-2 (better quality, ~5x cost).
//      If gpt-image-2 fails for ANY reason — model unavailable, content
//      moderation block, quota, transient OpenAI 5xx — we silently
//      retry on dall-e-3. The user ends up with SOME image rather than
//      a stuck empty placeholder. Previously the routes would just
//      return 500 and the frontend would shimmer-then-die with no
//      explanation; this fixed several "easy-mode projects never got
//      any AI images" reports (e.g. the "Turned Around" projects).
//
//   2. Logging. Every attempt logs to the server console with a
//      stable `context` tag so failures are findable. Without these
//      logs an intermittent gpt-image-2 outage looks identical to a
//      bug on our end.
//
// Returns a discriminated-union result so callers don't have to
// unpack HTTP responses themselves.
//
// NOTE: size strings differ by surface (project cover = wide,
// scene = landscape, character = portrait), so callers pass the
// right size per model.

export type ImageGenResult =
  | { ok: true; b64: string; model: "gpt-image-2" | "dall-e-3" }
  | {
      ok: false;
      /** Human-readable message, extracted from OpenAI's error envelope
       *  when present, else the raw response text (truncated). */
      error: string;
      /** OpenAI's machine-readable error code, e.g.
       *  "billing_hard_limit_reached", "insufficient_quota",
       *  "content_policy_violation". null when we couldn't parse one. */
      code: string | null;
      status: number;
    };

export type ImageGenSizes = {
  /** Size string for gpt-image-2 — must have both edges divisible by 16
   *  and aspect ratio ≤ 3:1. Common: 1536x768 (2:1), 1536x1024 (3:2),
   *  1024x1280 (4:5), 1024x1536 (2:3). */
  gptImage2: string;
  /** Size string for dall-e-3 — one of "1024x1024", "1024x1792",
   *  "1792x1024". The route picks whichever is closest to its target
   *  aspect; sharp then center-crops to the final dimensions. */
  dallE3: string;
};

export async function generateImageWithFallback(opts: {
  apiKey: string;
  prompt: string;
  sizes: ImageGenSizes;
  /** Short tag for log lines — e.g. "thumbnail", "scene-image",
   *  "character-image". Helps correlate failures across routes. */
  context: string;
  /** When true (v2 users) try gpt-image-2 first, then dall-e-3 on
   *  failure. When false (v1 users) go straight to dall-e-3 — no
   *  upgrade path to gpt-image-2. */
  preferV2: boolean;
}): Promise<ImageGenResult> {
  const { apiKey, prompt, sizes, context, preferV2 } = opts;

  // Parse OpenAI's standard error envelope. Their error responses
  // look like:
  //   { "error": { "message": "...", "type": "...", "code": "..." } }
  // We extract a single readable string + the machine-readable code so
  // callers can branch on specific failure modes (e.g. billing hard
  // limit, where retrying with dall-e-3 is pointless because both
  // models share the same OpenAI account).
  function parseOpenAIError(raw: string): { message: string; code: string | null } {
    try {
      const obj = JSON.parse(raw);
      const message =
        obj?.error?.message ||
        obj?.message ||
        (typeof obj === "string" ? obj : null);
      const code = obj?.error?.code || null;
      if (message) return { message: String(message), code: code ? String(code) : null };
    } catch { /* not JSON, fall through */ }
    // Truncate raw text so we don't shove a 5KB error blob into a toast.
    return { message: raw.slice(0, 300), code: null };
  }

  // Some failures cannot be resolved by switching models — e.g. when
  // the OpenAI account itself is rate-limited or has hit its hard
  // billing cap, every model returns the same error. Detecting these
  // codes lets us skip the fallback attempt and fail fast with a
  // single readable message.
  function isUnrecoverable(code: string | null): boolean {
    if (!code) return false;
    return (
      code === "billing_hard_limit_reached" ||
      code === "insufficient_quota" ||
      code === "account_deactivated"
    );
  }

  async function tryModel(model: "gpt-image-2" | "dall-e-3"): Promise<ImageGenResult> {
    const body = model === "gpt-image-2"
      ? {
          model,
          prompt,
          n: 1,
          size: sizes.gptImage2,
          quality: "high",
          // No response_format — gpt-image-2 always returns
          // base64 in data[0].b64_json; passing the param 400s.
        }
      : {
          model,
          prompt,
          n: 1,
          size: sizes.dallE3,
          response_format: "b64_json",
          quality: "standard",
        };
    try {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const raw = await res.text();
        const parsed = parseOpenAIError(raw);
        console.error(`[${context}] ${model} returned ${res.status} code=${parsed.code || "none"}:`, parsed.message);
        return { ok: false, error: parsed.message, code: parsed.code, status: res.status };
      }
      const data = await res.json();
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) {
        const preview = JSON.stringify(data).slice(0, 500);
        console.error(`[${context}] ${model} returned no b64_json:`, preview);
        return { ok: false, error: "API returned no b64_json", code: null, status: 500 };
      }
      return { ok: true, b64, model };
    } catch (err: any) {
      console.error(`[${context}] ${model} threw:`, err?.message || err);
      return { ok: false, error: err?.message || String(err), code: null, status: 500 };
    }
  }

  if (preferV2) {
    const v2 = await tryModel("gpt-image-2");
    if (v2.ok) {
      console.log(`[${context}] success via gpt-image-2`);
      return v2;
    }
    // If the failure is account-level (billing limit, no quota), the
    // dall-e-3 retry will fail with the same error — skip it.
    if (!v2.ok && isUnrecoverable(v2.code)) {
      console.warn(`[${context}] gpt-image-2 hit unrecoverable error (${v2.code}), NOT retrying dall-e-3`);
      return v2;
    }
    console.warn(`[${context}] gpt-image-2 failed (${v2.error.slice(0, 120)}…), falling back to dall-e-3`);
    const fallback = await tryModel("dall-e-3");
    if (fallback.ok) {
      console.log(`[${context}] success via dall-e-3 (fallback)`);
    }
    return fallback;
  }

  const v1 = await tryModel("dall-e-3");
  if (v1.ok) {
    console.log(`[${context}] success via dall-e-3`);
  }
  return v1;
}
