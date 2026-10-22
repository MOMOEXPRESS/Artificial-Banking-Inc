import type { MetadataRoute } from "next";
import { getSiteUrl } from "../lib/site";

/** Public marketing routes only — console / approvals / API stay out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const lastModified = new Date();

  return [
    { url: base, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/docs`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/pricing`, lastModified, changeFrequency: "monthly", priority: 0.7 },
  ];
}
