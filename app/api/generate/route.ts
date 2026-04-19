// The single AI endpoint. All actions flow through here.
// - Streams the response to the browser
// - Uses prompt caching (ephemeral cache_control) for cheap iteration
// - Routes to Haiku or Sonnet per action type
// - Logs tokens + live cost to the server console

import Anthropic from "@anthropic-ai/sdk";
import { Story } from "@/lib/story";
import { ActionRequest, modelForAction, costFromUsage } from "@/lib/prompt";
import { buildPrompt } from "@/lib/contextBuilder";
import type { WriterProfile } from "@/lib/writerProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
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

    // Sync extractions can be large — a full-feature script's cast plus
    // every character field can exceed 4k tokens. Give sync ops more
    // headroom; keep everything else at the original default.
    const maxTokens = wantsJsonPrefill ? 8192 : 4096;

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
