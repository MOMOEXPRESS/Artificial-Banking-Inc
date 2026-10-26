import { browserApiBase } from "./browser-api";

const API = browserApiBase();

function readPartnerCsrf(cookie: string): string {
  const hit = cookie.split(";").find((c) => c.trim().startsWith("abi_partner_csrf="));
  return hit ? decodeURIComponent(hit.trim().slice("abi_partner_csrf=".length)) : "";
}

export async function sellerApiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (typeof document !== "undefined" && init.method && init.method.toUpperCase() !== "GET") {
    const csrf = readPartnerCsrf(document.cookie);
    if (csrf) headers.set("x-abi-csrf", csrf);
  }
  return fetch(`${API}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });
}

export async function sellerApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; issues?: { message?: string }[] };
  } | null;
  return body?.error?.issues?.[0]?.message ?? body?.error?.message ?? fallback;
}
