"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
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

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      applyDesignForEmail(session?.user?.email);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        applyDesignForEmail(session?.user?.email);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

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
    <AuthContext.Provider value={{ user, session, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
