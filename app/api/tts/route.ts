// Text-to-speech endpoint.
// Accepts { text, voice, instructions } and returns MP3 bytes from OpenAI's
// gpt-4o-mini-tts model. The client caches the response in IndexedDB keyed
// by (text, voice, instructions) so re-plays are free.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard cap per request to prevent runaway cost on accidentally enormous inputs.
// gpt-4o-mini-tts accepts up to ~4096 chars — we clamp defensively below that.
const MAX_CHARS = 4000;

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const rawText: string = (body?.text ?? "").toString();
    const voice: string = (body?.voice ?? "onyx").toString();
    const instructions: string | undefined = body?.instructions
      ? body.instructions.toString()
      : undefined;

    const text = rawText.trim().slice(0, MAX_CHARS);
    if (!text) {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        input: text,
        voice,
        ...(instructions ? { instructions } : {}),
        response_format: "mp3",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `TTS error: ${err}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? "unknown" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
