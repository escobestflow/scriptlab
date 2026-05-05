// Dev-only helper: converts a list of short "note" moments into a list of
// well-formed AI coding prompts, one per note. The notes are written by
// the app's developer (us) while using the app — each note describes an
// app edit we want to make later. This endpoint polishes those shorthand
// notes into complete prompts suitable for pasting into an AI coding
// assistant.
//
// Will be hidden from end users. Keep this route cheap and unauthenticated
// (same Anthropic API key as /api/generate).

import Anthropic from "@anthropic-ai/sdk";
import { isBetaAllowed, BETA_FORBIDDEN_RESPONSE } from "@/lib/betaAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You convert developer shorthand notes into polished AI coding prompts for the ScriptWriter app (a Next.js / TypeScript / React screenwriting tool).

Input: a numbered list of short notes, each describing an app edit the developer wants to make to the ScriptWriter codebase.

Output rules:
- For EACH input note, produce ONE corresponding AI coding prompt.
- Each prompt should be written as a clear, specific task directed at an AI coding assistant, as if the developer were asking it to implement the edit.
- Reframe terse notes into full-sentence instructions with enough context that an AI working on the ScriptWriter codebase could act on them without needing more info. Do NOT invent implementation details that aren't implied by the note.
- Preserve the developer's intent exactly — don't add new requirements.
- If a note is ambiguous, write the prompt in a way that flags the ambiguity ("clarify if…" or "assume X unless the codebase suggests otherwise").
- Number the output prompts to match the input numbering (1., 2., 3., …).
- Separate each prompt with a blank line.
- Return ONLY the numbered prompts. No preamble, no explanations, no trailing summary.`;

export async function POST(req: Request) {
  // Beta gate — see app/api/generate/route.ts for the rationale.
  if (!isBetaAllowed(req.headers.get("x-user-email"))) {
    return Response.json(BETA_FORBIDDEN_RESPONSE.body, {
      status: BETA_FORBIDDEN_RESPONSE.status,
    });
  }
  try {
    const { notes } = (await req.json()) as { notes: string[] };
    if (!Array.isArray(notes) || notes.length === 0) {
      return new Response("No notes provided.", { status: 400 });
    }

    const numbered = notes
      .map((n, i) => `${i + 1}. ${n.trim()}`)
      .join("\n\n");

    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            "Convert the following developer notes into AI coding prompts for the ScriptWriter app:\n\n" +
            numbered,
        },
      ],
    });

    const text = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`convert-notes error: ${msg}`, { status: 500 });
  }
}
