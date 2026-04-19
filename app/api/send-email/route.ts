// Email delivery endpoint.
//
// POST body: { type: "project_bundle", story, toEmail }
//
// Phase 1 only supports `project_bundle`. It renders three artifacts
// from the same Story:
//   - HTML body        → React Email, readable in the inbox
//   - .fountain file   → lib/fountain.ts, attached
//   - .json snapshot   → complete Story object, attached
// and hands them to Resend. Resend's total-attachment cap is 40 MB;
// the .fountain and .json are pure text so we never approach it in
// practice.
//
// AUTH NOTE: we match the existing client-trust pattern in
// /api/generate and /api/tts — no server-side Supabase session
// verification. The client passes its own authenticated email as
// `toEmail`; the server just relays to whatever it's given. This is
// safe for Phase 1 because the only surface is "email the signed-in
// user their own content." When we add share-with-collaborator
// (Phase 1 option f), we'll need to add server-side session
// verification so a malicious client can't send spam to arbitrary
// recipients.
//
// Env:
//   RESEND_API_KEY  required
//   EMAIL_FROM      optional, defaults to Resend's shared sandbox
//                   ("Unfold <onboarding@resend.dev>"). Swap to a
//                   domain-verified address once DNS is wired.
//   APP_URL         optional; embedded as the "Open in Unfold →" link
//                   in the email footer. Falls back to the request's
//                   Origin header.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Resend } from "resend";
import {
  renderProjectBundleHtml,
  serializeProjectJson,
  slugify,
} from "@/lib/email/projectBundle";
import { serializeFountain } from "@/lib/fountain";
import type { Story } from "@/lib/story";

interface SendRequest {
  type?: string;
  story?: Story;
  toEmail?: string;
}

export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ error: "RESEND_API_KEY not set on the server" }, 500);
  }

  let payload: SendRequest;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { type, story, toEmail } = payload;

  if (type !== "project_bundle") {
    return json({ error: `Unsupported email type: ${type ?? "(missing)"}` }, 400);
  }
  if (!story || typeof story !== "object") {
    return json({ error: "story required" }, 400);
  }
  if (!toEmail || !isValidEmail(toEmail)) {
    return json({ error: "toEmail required and must be a valid email" }, 400);
  }

  const from = process.env.EMAIL_FROM || "Unfold <onboarding@resend.dev>";
  const appUrl =
    process.env.APP_URL ||
    req.headers.get("origin") ||
    "https://script-lab-beta.vercel.app";

  const titleSlug = slugify(story.title || "project");
  const subject = `Your project bundle — ${story.title || "Untitled"}`;

  // Build all three artifacts. Any one failing should surface a
  // useful error (not "attachments: undefined") so we try/catch.
  let html: string;
  let fountainText: string;
  let jsonText: string;
  try {
    html = await renderProjectBundleHtml(story, appUrl);
    fountainText = serializeFountain(story);
    jsonText = serializeProjectJson(story);
  } catch (err: any) {
    return json(
      { error: `Failed to render email artifacts: ${err?.message ?? String(err)}` },
      500,
    );
  }

  const resend = new Resend(apiKey);
  try {
    const result = await resend.emails.send({
      from,
      to: toEmail,
      subject,
      html,
      attachments: [
        {
          filename: `${titleSlug}.fountain`,
          content: Buffer.from(fountainText, "utf-8"),
        },
        {
          filename: `${titleSlug}.json`,
          content: Buffer.from(jsonText, "utf-8"),
        },
      ],
    });

    // Resend SDK returns { data, error } — error is null on success.
    if (result.error) {
      return json(
        { error: `Resend rejected send: ${result.error.message ?? "unknown"}` },
        502,
      );
    }
    return json({ ok: true, id: result.data?.id ?? null }, 200);
  } catch (err: any) {
    return json(
      { error: `Resend threw: ${err?.message ?? String(err)}` },
      502,
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidEmail(s: string): boolean {
  // Minimal RFC-5322-ish check; Resend does its own validation too.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
