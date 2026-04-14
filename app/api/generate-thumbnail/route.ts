// Generates a project thumbnail via DALL-E 3.
// Returns the image as a base64 data URL so it can be stored in the Story object.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { title, logline, genres } = await req.json();

    const description = logline
      ? `${title}: ${logline}`
      : title || "an untitled film project";

    const genreStr = genres?.length ? genres.join(" and ") : "drama";

    const prompt = `flat minimal design illustration, representing a ${genreStr} movie about ${description}, simple geometric shapes, basic muted earthy colors with orange and teal accents, geometric human figures, textured grain effect, dark moody background, no text, no words, no letters`;

    // Call DALL-E 3
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json",
        quality: "standard",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `DALL-E error: ${err}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;

    if (!b64) {
      return new Response(JSON.stringify({ error: "No image returned" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const dataUrl = `data:image/png;base64,${b64}`;

    return new Response(JSON.stringify({ thumbnail: dataUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
