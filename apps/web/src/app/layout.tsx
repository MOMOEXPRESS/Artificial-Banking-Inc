import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppProviders } from "../lib/providers";
import { OG_IMAGE } from "../lib/og";
import "./globals.css";
import "./controls.css";
import "./refinements.css";
import "./waitlist.css";
import "./design-system.css";
import "./legal.css";
import "./compliance.css";
import "./marketplace.css";
import "./console-studio.css";
import "./public-studio.css";
import "./minimal-workspace.css";
import "./reference-console.css";
import "./liquid-wallet.css";
import "./agent-logo-cluster.css";
import "./settings-resources.css";

// Self-hosted Inter (SIL OFL; fonts/OFL-Inter.txt) matches the supplied reference.
const interSans = localFont({
  src: "./fonts/inter-variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-sans",
  display: "swap",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://artificial-banking-inc-web.vercel.app";

const SITE_TITLE = "ABI — The agentic marketplace";
const SITE_DESCRIPTION =
  "Discover software, digital services and physical goods. Let your agent compare products and prepare purchases under your budget and approval rules.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Artificial Banking Inc.",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ABI",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${interSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
