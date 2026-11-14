import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverIdentity, apiOrigin } from "@/lib/supabase/server";
export async function POST(req: NextRequest) {
  if (
    !sameOrigin(req) ||
    !req.cookies.get("abi_identity_csrf")?.value ||
    req.headers.get("x-abi-identity-csrf") !== req.cookies.get("abi_identity_csrf")?.value
  )
    return NextResponse.json({ error: { code: "CSRF_FAILED" } }, { status: 403 });
  const origin = apiOrigin();
  if (!origin)
    return NextResponse.json(
      { error: { message: "The ABI API is not configured." } },
      { status: 503 },
    );
  try {
    const s = serverIdentity(req);
    const {
      data: { user },
      error,
    } = await s.client.auth.getUser();
    if (
      error &&
      (!error.status ||
        error.status === 429 ||
        error.status >= 500 ||
        error.name === "AuthRetryableFetchError")
    )
      throw error;
    if (error || !user)
      return s.apply(NextResponse.json({ error: { message: "Sign in again." } }, { status: 401 }));
    const {
      data: { session },
    } = await s.client.auth.getSession();
    if (!session)
      return s.apply(NextResponse.json({ error: { message: "Sign in again." } }, { status: 401 }));
    const input = await req.json();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
      cookie: req.headers.get("cookie") ?? "",
    };
    const csrf = req.cookies.get("abi_csrf")?.value;
    if (csrf) headers["x-abi-csrf"] = csrf;
    if (process.env.ABI_SIGNUP_TOKEN) headers["x-abi-signup-token"] = process.env.ABI_SIGNUP_TOKEN;
    const r = await fetch(`${origin}/v1/auth/supabase/exchange`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json();
    const response = NextResponse.json(
      {
        ...data,
        destination:
          req.cookies.get("abi_auth_destination")?.value === "seller" ? "seller" : "console",
      },
      { status: r.status },
    );
    for (const cookie of r.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    if (r.ok) {
      await s.client.from("abi_profiles").upsert({
        id: user.id,
        display_name: String(data.user?.name ?? "").slice(0, 80),
        updated_at: new Date().toISOString(),
      });
      response.cookies.delete("abi_identity_csrf");
      response.cookies.delete("abi_auth_destination");
    }
    return s.apply(response);
  } catch {
    return NextResponse.json(
      { error: { message: "Sign-in could not finish. Try again." } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
