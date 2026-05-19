// The single AI endpoint. All actions flow through here.
// - Streams the response to the browser
// - Uses prompt caching (ephemeral cache_control) for cheap iteration
// - Routes to Haiku or Sonnet per action type
// - Logs tokens + live cost to the server console

import Anthropic from "@anthropic-ai/sdk";
import { Story } from "@/lib/story";
import { ActionRequest, modelForAction, costFromUsage } from "@/lib/prompt";
import { buildPrompt } from "@/lib/contextBuilder";
import { isBetaAllowed, BETA_FORBIDDEN_RESPONSE } from "@/lib/betaAccess";
import type { WriterProfile } from "@/lib/writerProfile";
import { logUsage } from "@/lib/usageLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
  // Beta gate. AuthProvider injects X-User-Email on every /api/* fetch
  // — empty string when signed out. Block calls from anyone not on
  // NEXT_PUBLIC_ALLOWED_EMAILS so backend AI costs are gated even if
  // the client-side gate is bypassed.
  const userEmail = req.headers.get("x-user-email");
  if (!isBetaAllowed(userEmail)) {
    return Response.json(BETA_FORBIDDEN_RESPONSE.body, {
      status: BETA_FORBIDDEN_RESPONSE.status,
    });
  }
  try {
    const { story, action, profile } = (await req.json()) as {
      story: Story;
      action: ActionRequest;
      profile?: WriterProfile | null;
    };

    const model = modelForAction(action.type);
    const { system, userMessage } = buildPrompt(story, action, profile);

    // Every `sync_*_to_*` action asks the model for strict JSON. Haiku
    // occasionally ignores that instruction and opens with prose like
    // "I'll extract the characters…". The reliable fix is Anthropic's
    // prefill feature: seed the assistant turn with `{` so the model
    // is literally forced to continue from inside a JSON object. We
    // also emit that same `{` as the first streamed text chunk so the
    // client reconstructs the complete JSON string.
    const wantsJsonPrefill = action.type.startsWith("sync_");
    const JSON_PREFILL = "{";

    // Output-budget tiers, smallest to largest:
    //   - 4k  → per-field generators (logline, single character name)
    //   - 8k  → sync_* that returns structured metadata (characters,
    //           beats) — a full cast with every field can hit ~6k.
    //   - 32k → anything that emits a full screenplay's worth of prose:
    //           every sync_*_to_script (22 feature scenes × ~250 words
    //           ≈ 7k content tokens, plus JSON encoding overhead, has
    //           historically truncated at 8k mid-array), and the import
    //           pipeline which extracts/summarizes every scene of an
    //           uploaded screenplay. Sonnet-4.5 supports up to 64k
    //           output tokens; 32k is conservative headroom and ~4×
    //           the worst observed real-world response.
    const isScriptHeavy =
      action.type === "sync_concept_to_script" ||
      action.type === "sync_characters_to_script" ||
      action.type === "sync_story_to_script" ||
      action.type === "import_extract_scenes" ||
      action.type === "import_summarize_scenes";
    const maxTokens = isScriptHeavy ? 32000 : wantsJsonPrefill ? 8192 : 4096;

    const messages: any[] = [{ role: "user", content: userMessage }];
    if (wantsJsonPrefill) {
      messages.push({ role: "assistant", content: JSON_PREFILL });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const t0 = Date.now();
        let textOut = "";
        let finalUsage: any = null;

        // Emit the prefill up-front so the client's concatenated text is
        // a complete JSON payload, not a headless continuation.
        if (wantsJsonPrefill) {
          textOut += JSON_PREFILL;
          controller.enqueue(encoder.encode(
            JSON.stringify({ type: "text", value: JSON_PREFILL }) + "\n"
          ));
        }

        try {
          const response = await client.messages.stream({
            model,
            max_tokens: maxTokens,
            system: system as any,
            messages,
          });

          for await (const event of response) {
            if (event.type === "content_block_delta" &&
                event.delta.type === "text_delta") {
              const chunk = event.delta.text;
              textOut += chunk;
              controller.enqueue(encoder.encode(
                JSON.stringify({ type: "text", value: chunk }) + "\n"
              ));
            }
          }

          const finalMessage = await response.finalMessage();
          finalUsage = finalMessage.usage;
        } catch (err: any) {
          controller.enqueue(encoder.encode(
            JSON.stringify({ type: "error", value: err.message }) + "\n"
          ));
        }

        const ms = Date.now() - t0;

        if (finalUsage) {
          const cost = costFromUsage(model, finalUsage);
          const report = {
            model,
            action: action.type,
            ms,
            tokens: {
              input: finalUsage.input_tokens,
              output: finalUsage.output_tokens,
              cacheWrite: finalUsage.cache_creation_input_tokens ?? 0,
              cacheRead: finalUsage.cache_read_input_tokens ?? 0,
            },
            cost: {
              input: +cost.input.toFixed(6),
              output: +cost.output.toFixed(6),
              cacheWrite: +cost.cWrite.toFixed(6),
              cacheRead: +cost.cRead.toFixed(6),
              total: +cost.total.toFixed(6),
            },
          };

          // Log to server terminal so you can literally watch the economics.
          console.log("\n[ScriptWriter]",
            JSON.stringify(report, null, 2));

          // Also send the cost report to the client so the UI can show it.
          controller.enqueue(encoder.encode(
            JSON.stringify({ type: "report", value: report }) + "\n"
          ));
        }

        // Persist to usage_log — fire-and-forget; never throws.
        // Done in parallel with controller.close() so streaming
        // latency to the client is unaffected. projectName is
        // captured at call time so the dashboard can group by it
        // even if the project is later renamed or deleted.
        void logUsage({
          userEmail,
          projectId: story?.id ?? null,
          projectName: typeof story?.title === "string" ? story.title : null,
          provider: "anthropic",
          kind: "text",
          model,
          action: action.type,
          textUsage: finalUsage ?? {},
        });

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
