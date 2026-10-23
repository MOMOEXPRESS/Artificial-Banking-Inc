/**
 * Browser API base URL.
 *
 * Session cookies are httpOnly and set through the same-origin `/abi-api`
 * proxy. An absolute `NEXT_PUBLIC_API_URL` (e.g. the Render host) makes the
 * browser talk cross-origin; SameSite=Lax cookies then never stick and every
 * reload looks like a sign-out. Absolute URLs are therefore ignored here —
 * the Next.js proxy (`apps/web/src/app/abi-api`) still uses `ABI_API_ORIGIN`
 * server-side.
 */
export function browserApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured && !/^https?:\/\//i.test(configured)) {
    return configured.replace(/\/$/, "") || "/abi-api";
  }
  return "/abi-api";
}

/**
 * x402 seller URL for playground missions. Localhost is only valid in local
 * development; in hosted consoles leave unset and show a clear unavailable state.
 */
export function sellerUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SELLER_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:9402/report";
    }
    return null;
  }
  // SSR / build: keep local default for local next start.
  if (!process.env.VERCEL) return "http://localhost:9402/report";
  return null;
}
