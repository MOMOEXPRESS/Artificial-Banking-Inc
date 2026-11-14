import { NextRequest, NextResponse } from "next/server";
import { serverIdentity, supabaseConfig } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
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
      return s.apply(NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }));
    const {
      data: { session },
    } = await s.client.auth.getSession();
    if (!session) return s.apply(NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }));
    const config = supabaseConfig()!;
    return s.apply(
      NextResponse.json({
        url: config.url,
        key: config.key,
        userId: user.id,
        token: session.access_token,
        expiresAt: session.expires_at,
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "IDENTITY_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
