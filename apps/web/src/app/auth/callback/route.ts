import { NextRequest, NextResponse } from "next/server";
import { serverIdentity } from "@/lib/supabase/server";
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code || code.length > 2048)
    return NextResponse.redirect(new URL("/console?identity_error=callback", req.url));
  try {
    const s = serverIdentity(req);
    const { error } = await s.client.auth.exchangeCodeForSession(code);
    if (error) throw Error();
    const result = s.apply(NextResponse.redirect(new URL("/auth/complete", req.url)));
    result.cookies.set("abi_identity_csrf", crypto.randomUUID(), {
      httpOnly: false,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return result;
  } catch {
    return NextResponse.redirect(new URL("/console?identity_error=callback", req.url));
  }
}
