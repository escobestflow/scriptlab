"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "./supabase";
import { isBetaAllowed } from "./betaAccess";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** True when the most recent sign-in attempt resolved with an email
   *  not on the beta allowlist. The auth screen reads this to surface
   *  a "Beta access required" message. Cleared whenever the user
   *  re-attempts sign-in or fully signs out. */
  betaRejectedEmail: string | null;
  signInWithGoogle: () => Promise<void>;
  /** Dev-only email/password path. Used by /dev-login so verification
   *  tooling (and anyone without Google SSO configured) can bootstrap
   *  a session. Not wired into the normal splash flow.
   *  Returns null on success, error message on failure. */
  signInWithEmail: (email: string, password: string) => Promise<string | null>;
  /** Dev-only sign-up. Same surface as signInWithEmail — creates the
   *  user if they don't exist. Email confirmation must be disabled in
   *  the Supabase project for this to produce a live session. */
  signUpWithEmail: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  betaRejectedEmail: null,
  signInWithGoogle: async () => {},
  signInWithEmail: async () => "not-initialised",
  signUpWithEmail: async () => "not-initialised",
  signOut: async () => {},
});

// V2 redesign allowlist. Read from NEXT_PUBLIC_V2_EMAILS, normalized
// to lowercase. The same list is also inlined into the pre-hydration
// script in app/layout.tsx so the first paint applies the right design
// without waiting for auth — this runtime copy keeps things in sync
// when the user signs in/out mid-session.
const V2_EMAILS: string[] = (process.env.NEXT_PUBLIC_V2_EMAILS ?? "")
  .split(",")
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function applyDesignForEmail(email: string | null | undefined) {
  if (typeof document === "undefined") return;
  const lower = (email ?? "").toLowerCase();
  const design = lower && V2_EMAILS.includes(lower) ? "v2" : "v1";
  document.documentElement.dataset.design = design;
  // Cache the email so the next page load's pre-hydration script can
  // pick the correct design before React mounts (anti-flash). Cleared
  // on sign-out below so the next user on the same device starts on
  // v1, never briefly seeing the previous user's v2.
  try {
    if (lower) {
      localStorage.setItem("scriptlab:user-email", lower);
    } else {
      localStorage.removeItem("scriptlab:user-email");
    }
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [betaRejectedEmail, setBetaRejectedEmail] = useState<string | null>(null);

  // Beta gate: if the user signs in with an email that isn't on the
  // allowlist, immediately sign them out and surface the rejected
  // email so the auth screen can render a friendly message. Existing
  // allowlisted users see no change. The server gate on every paid
  // API route protects the backend from anyone who bypasses this
  // client check (curl, modified bundle, etc).
  async function enforceBetaGate(sess: Session | null): Promise<Session | null> {
    const email = sess?.user?.email ?? null;
    if (!sess || !email) return sess;
    if (isBetaAllowed(email)) {
      setBetaRejectedEmail(null);
      return sess;
    }
    setBetaRejectedEmail(email);
    await supabase.auth.signOut();
    return null;
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const gated = await enforceBetaGate(session);
      setSession(gated);
      setUser(gated?.user ?? null);
      setLoading(false);
      applyDesignForEmail(gated?.user?.email);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const gated = await enforceBetaGate(session);
        setSession(gated);
        setUser(gated?.user ?? null);
        setLoading(false);
        applyDesignForEmail(gated?.user?.email);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Server-side beta gate: every /api/* call gets an X-User-Email
  // header so the protected routes (generate, tts, etc.) can verify
  // the caller is on the allowlist before incurring AI costs.
  // Implemented as a fetch wrapper rather than 14 call-site refactors —
  // single source of truth, no missed paths. Wrapper falls through to
  // the original fetch for any non-/api request, so unrelated network
  // traffic (Supabase RPCs, Google Fonts, etc.) is untouched.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      // Only inject for in-app API routes — leave Supabase, fonts,
      // analytics, and any future cross-origin calls alone.
      if (url.startsWith("/api/")) {
        const email = user?.email ?? "";
        const headers = new Headers(init?.headers);
        if (email && !headers.has("x-user-email")) {
          headers.set("X-User-Email", email);
        }
        return originalFetch(input, { ...init, headers });
      }
      return originalFetch(input, init);
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [user?.email]);

  async function signInWithGoogle() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: origin,
      },
    });
  }

  async function signInWithEmail(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    return null;
  }

  async function signUpWithEmail(email: string, password: string): Promise<string | null> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    // If email confirmation is enabled in the Supabase project, session
    // will be null here and the account sits pending confirmation. Surface
    // that so the dev-login form can show an actionable hint.
    if (!data.session) {
      return "signup-pending-confirmation";
    }
    return null;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    applyDesignForEmail(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, betaRejectedEmail, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
