import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata = {
  title: "PlotTwist",
  description: "Iterative screenwriting, structured by AI.",
  manifest: "/manifest.webmanifest",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
  themeColor: "#FDFEFE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // V2-allowlist baked in at build time. NEXT_PUBLIC_V2_EMAILS is a
  // comma-separated list, normalized to lowercase. Read here in the
  // server component so the pre-hydration script below has the list
  // inline as a JS array literal — no runtime fetch, no flash.
  const v2EmailsRaw = process.env.NEXT_PUBLIC_V2_EMAILS ?? "";
  const v2Emails = v2EmailsRaw
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  const v2EmailsLiteral = JSON.stringify(v2Emails);

  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;500;600;700;900&display=swap"
          rel="stylesheet"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="PlotTwist" />
        {/* Pre-hydration theme bootstrap — runs before React mounts so
            the correct palette is applied on the first paint (no
            flash-of-light-content when the user has dark mode on).
            Mirrors the key + serialization used by useDarkModePref. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('scriptlab:darkmode');" +
              "document.documentElement.dataset.theme=(t==='1')?'dark':'light';}" +
              "catch(e){document.documentElement.dataset.theme='light';}",
          }}
        />
        {/* Pre-hydration design bootstrap — same anti-flash pattern as
            the theme bootstrap above. Reads the cached email from
            localStorage (written by AuthProvider whenever auth resolves)
            and flips html[data-design] to "v2" for allowlisted emails,
            "v1" otherwise. Signed-out viewers default to v1.
            The v2 allowlist is baked in at build time from
            NEXT_PUBLIC_V2_EMAILS — see .env.local.example. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var v2=" + v2EmailsLiteral + ";" +
              "var e=(localStorage.getItem('scriptlab:user-email')||'').toLowerCase();" +
              "document.documentElement.dataset.design=(e&&v2.indexOf(e)>=0)?'v2':'v1';}" +
              "catch(e){document.documentElement.dataset.design='v1';}",
          }}
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
