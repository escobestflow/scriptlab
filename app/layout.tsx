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
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
