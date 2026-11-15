import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, serverIdentity } from "@/lib/supabase/server";
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await req.formData();
  const provider = form.get("provider");
  if (provider !== "google" && provider !== "github")
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  try {
    const s = serverIdentity(req);
    const { data, error } = await s.client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${req.nextUrl.origin}/auth/callback`,
        skipBrowserRedirect: true,
        ...(provider === "github" ? { scopes: "user:email" } : { scopes: "openid email profile" }),
      },
    });
    if (error || !data.url) throw Error();
    const result = s.apply(NextResponse.redirect(data.url, 303));
    result.cookies.set(
      "abi_auth_destination",
      form.get("destination") === "seller" ? "seller" : "console",
      {
        httpOnly: true,
        secure: req.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      },
    );
    return result;
  } catch {
    return NextResponse.redirect(new URL("/console?identity_error=unavailable", req.url), 303);
  }
}
