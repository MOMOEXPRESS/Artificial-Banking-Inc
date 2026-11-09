// Social preview image (1200x630, apps/web/public/og-home.png) used when an ABI link is shared.
// It is a screenshot of the homepage's first screen (desktop, above the fold, cookie notice dismissed).
// When the homepage changes, retake it and give the file a new name so X, WhatsApp, etc. refetch it.
// Relative URL: resolved to an absolute URL against metadataBase in app/layout.tsx.
export const OG_IMAGE = {
  url: "/og-home.png",
  width: 1200,
  height: 630,
  alt: "ABI homepage — Everything your agents need. One marketplace.",
  type: "image/png",
};
