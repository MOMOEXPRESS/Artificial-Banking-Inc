import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
export function supabaseConfig() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
export function sameOrigin(req: NextRequest) {
  return req.headers.get("origin") === req.nextUrl.origin;
}
export function serverIdentity(req: NextRequest) {
  const config = supabaseConfig();
  if (!config) throw Error("Social sign-in is not configured.");
  const jar = new Map(req.cookies.getAll().map((c) => [c.name, c.value]));
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const client = createServerClient(config.url, config.key, {
    cookieOptions: {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          jar.set(cookie.name, cookie.value);
          pending.set(cookie.name, cookie);
        }
      },
    },
  });
  return {
    client,
    apply: (response: NextResponse) => {
      for (const c of pending.values())
        response.cookies.set(c.name, c.value, {
          ...c.options,
          httpOnly: true,
          secure: req.nextUrl.protocol === "https:",
          sameSite: "lax",
          path: "/",
        });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Pragma", "no-cache");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    },
  };
}
export function hasIdentityCookie(req: NextRequest) {
  return req.cookies.getAll().some((c) => /^sb-.+-auth-token(?:\.\d+)?$/.test(c.name));
}
export function apiOrigin() {
  return (
    process.env.ABI_API_ORIGIN?.replace(/\/$/, "") ??
    (!process.env.VERCEL ? "http://127.0.0.1:8787" : null)
  );
}
