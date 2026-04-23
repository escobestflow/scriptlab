"use client";

// Invite acceptance landing page.
//
// Flow: a project creator shares the URL /accept-invite/<token>.
// When this page mounts:
//   1. If not signed in, show a "sign in" CTA. The same Google SSO
//      that the home page uses. After sign-in the user lands back
//      here with a session and we progress.
//   2. If signed in, call acceptInvite(token, userId). On success,
//      redirect to `/?project=<id>` so the landing-dashboard opens
//      the newly-shared project. On failure, show a clear message.
//
// The actual row-wiring (setting collaborator_user_id on the
// creator's row, seeding the invitee's row, marking the invite
// consumed) all happens inside lib/invites.ts :: acceptInvite.

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { acceptInvite, AcceptError } from "@/lib/invites";

const ERROR_COPY: Record<AcceptError, string> = {
  "not-found":       "This invite link isn't valid. Ask the project owner for a fresh one.",
  "already-used":    "This invite has already been used. Ask the project owner for a fresh one.",
  "self-accept":     "This is your own invite — send it to someone else to collaborate.",
  "project-full":    "This project already has a collaborator. Only two people can work on the same project.",
  "project-missing": "The project for this invite no longer exists.",
  "email-mismatch":  "This invite was sent to a different email. Sign in with the address the project owner invited.",
  "write-failed":    "Something went wrong setting up the collaboration. Try again in a moment.",
};

export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const token = params?.code ?? "";
  const { user, loading, signInWithGoogle } = useAuth();
  const [status, setStatus] = useState<"idle" | "accepting" | "error" | "done">("idle");
  const [errorKey, setErrorKey] = useState<AcceptError | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) return;               // waiting for sign-in
    if (!token) { setStatus("error"); setErrorKey("not-found"); return; }
    if (status !== "idle") return;   // already processing or done

    let cancelled = false;
    (async () => {
      setStatus("accepting");
      const res = await acceptInvite(token, user.id);
      if (cancelled) return;
      if (typeof res === "string") {
        setErrorKey(res);
        setStatus("error");
        return;
      }
      setStatus("done");
      // Defer nav one tick so the user sees the "joined" flash before
      // we whisk them to the dashboard. The home page doesn't
      // currently auto-open a specific project from query params, so
      // we just route home — the invited project will appear in
      // their dashboard list.
      setTimeout(() => router.replace("/"), 600);
    })();
    return () => { cancelled = true; };
    // `status` is tracked inside the closure guard above; omitting it
    // from deps avoids double-runs when setStatus bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, token]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420, width: "100%" }}>
        <div className="display heading" style={{ marginBottom: 12 }}>
          {status === "done"
            ? "You're in."
            : status === "error"
            ? "Invite problem"
            : "Collaboration invite"}
        </div>

        {loading && (
          <div className="caption" style={{ marginBottom: 20 }}>Loading…</div>
        )}

        {!loading && !user && (
          <>
            <div className="caption" style={{ marginBottom: 24 }}>
              Sign in to accept the invite and add the project to your dashboard.
            </div>
            <button
              className="btn-primary"
              style={{
                width: "100%",
                padding: "14px 18px",
                borderRadius: 12,
                border: "none",
                fontWeight: 600,
                cursor: "pointer",
                background: "var(--ink, #111)",
                color: "var(--paper, #fff)",
              }}
              onClick={() => signInWithGoogle()}
            >
              Continue with Google
            </button>
          </>
        )}

        {!loading && user && status === "accepting" && (
          <div className="caption">Adding this project to your dashboard…</div>
        )}

        {status === "done" && (
          <div className="caption">Taking you to your dashboard…</div>
        )}

        {status === "error" && errorKey && (
          <>
            <div className="caption" style={{ marginBottom: 24 }}>
              {ERROR_COPY[errorKey]}
            </div>
            <button
              className="btn-secondary"
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid var(--ink, #111)",
                background: "transparent",
                color: "var(--ink, #111)",
                cursor: "pointer",
              }}
              onClick={() => router.replace("/")}
            >
              Go to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
