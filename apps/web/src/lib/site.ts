import type { Metadata } from "next";

/** Brand and SEO helpers for the public Next.js app. */

export const SITE_NAME = "Artificial Banking Incorporated";
export const SITE_SHORT_NAME = "ABI";

export const DEFAULT_TITLE =
  "Artificial Banking Incorporated — Financial infrastructure for autonomous AI";

export const DEFAULT_DESCRIPTION =
  "Programmable AI agent wallets with policies, human approvals, and x402 payments — the authorization layer between AI agents and real money.";

/** Current Vercel production hostname for this web project. */
export const PRODUCTION_SITE_URL = "https://artificial-banking-inc-web.vercel.app";

/**
 * Absolute site origin for metadataBase, canonicals, sitemap, and JSON-LD.
 * Prefer NEXT_PUBLIC_SITE_URL so a future custom domain is a one-line env change.
 */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return PRODUCTION_SITE_URL;
}

export function absoluteUrl(path = "/"): string {
  const base = getSiteUrl();
  if (!path || path === "/") return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

type PageMetaInput = {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
};

/** Per-route Metadata using the root title template and shared OG/Twitter fields. */
export function pageMetadata({ title, description, path, noIndex }: PageMetaInput): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
  };
}
