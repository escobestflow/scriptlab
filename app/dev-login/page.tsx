"use client";

// Dev-only email/password sign-in page.
//
// Purpose: give automation tooling (and anyone without Google SSO set
// up) a way to bootstrap a Supabase session without the OAuth round-
// trip that Google blocks inside iframes / headless browsers.
//
// Usage:
//   1. In the Supabase Dashboard → Authentication → Providers → Email,
//      disable "Confirm email" (or pre-confirm the user in
//      Authentication → Users). Otherwise signUp will return a session-
//      less response and we won't be logged in.
//   2. Navigate to /dev-login.
//   3. Enter email + password. If the account exists, it signs in. If
//      not, it signs up. On success, redirects to `/` with a live
//      Supabase session in localStorage (same as Google flow).
//
// This file is safe to leave in the codebase permanently — the route
// only exposes functionality that the Supabase project already exposes
// via its Auth API. Users without an account literally cannot sign in
// here unless the project allows email/password signups.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function DevLoginPage() {
  const { signInWithEmail, signUpWithEmail, user, signOut } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus("Signing in…");
    const err = await signInWithEmail(email, password);
    if (err) {
      setStatus(`Sign-in failed: ${err}`);
      setBusy(false);
      return;
    }
    setStatus("Signed in — redirecting…");
    router.push("/");
  }

  async function handleSignUp() {
    setBusy(true);
    setStatus("Creating account…");
    const err = await signUpWithEmail(email, password);
    if (err === "signup-pending-confirmation") {
      setStatus(
        "Account created but requires email confirmation. Confirm in Supabase Dashboard → Authentication → Users, then sign in.",
      );
      setBusy(false);
      return;
    }
    if (err) {
      setStatus(`Sign-up failed: ${err}`);
      setBusy(false);
      return;
    }
    setStatus("Signed up — redirecting…");
    router.push("/");
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#000",
        color: "#fff",
        fontFamily: "'Lato', sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 20,
      }}
    >
      <h1 style={{ fontWeight: 300, letterSpacing: "0.04em", fontSize: 18 }}>
        Dev login
      </h1>
      <div
        style={{
          color: "rgba(255,255,255,0.55)",
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        Supabase email/password. Disable email confirmation in the
        project before first use.
      </div>

      {user ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <div style={{ fontSize: 14 }}>
            Signed in as <strong>{user.email}</strong>
          </div>
          <button
            type="button"
            style={btnStyle("secondary")}
            onClick={() => router.push("/")}
          >
            Go to app
          </button>
          <button
            type="button"
            style={btnStyle("ghost")}
            onClick={async () => {
              await signOut();
              setStatus("Signed out.");
            }}
          >
            Sign out
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSignIn}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            width: "100%",
            maxWidth: 320,
          }}
        >
          <input
            type="email"
            placeholder="email@example.com"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={busy} style={btnStyle("primary")}>
            Sign in
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSignUp}
            style={btnStyle("secondary")}
          >
            Sign up (create account)
          </button>
        </form>
      )}

      {status && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.75)",
            maxWidth: 360,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#111",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "inherit",
};

function btnStyle(kind: "primary" | "secondary" | "ghost"): React.CSSProperties {
  const base: React.CSSProperties = {
    height: 44,
    borderRadius: 10,
    border: "none",
    fontSize: 12,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontFamily: "inherit",
    cursor: "pointer",
  };
  if (kind === "primary") {
    return { ...base, background: "#fff", color: "#000" };
  }
  if (kind === "secondary") {
    return {
      ...base,
      background: "transparent",
      color: "#fff",
      border: "1px solid #444",
    };
  }
  return {
    ...base,
    background: "transparent",
    color: "rgba(255,255,255,0.6)",
  };
}
