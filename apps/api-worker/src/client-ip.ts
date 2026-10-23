/** Prefer CF-Connecting-IP, then leftmost x-forwarded-for. */
export function clientIpFromRequest(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  if (cf) return cf;
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return "0.0.0.0";
}

/** Ensure Express `trust proxy` sees a usable forwarded chain. */
export function withClientIpHeaders(request: Request): Request {
  const ip = clientIpFromRequest(request);
  const headers = new Headers(request.headers);
  if (!headers.get("CF-Connecting-IP")) {
    headers.set("CF-Connecting-IP", ip);
  }
  const existing = headers.get("x-forwarded-for");
  if (!existing) {
    headers.set("x-forwarded-for", ip);
  }
  return new Request(request, { headers });
}
