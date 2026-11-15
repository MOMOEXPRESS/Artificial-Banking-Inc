import { NextResponse } from "next/server";
import { supabaseConfig } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const c = supabaseConfig();
  if (!c) return NextResponse.json({ providers: [] }, { headers: { "cache-control": "no-store" } });
  try {
    const r = await fetch(`${c.url}/auth/v1/settings`, {
      headers: { apikey: c.key },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error();
    const s = await r.json();
    return NextResponse.json(
      { providers: ["google", "github"].filter((p) => s.external?.[p] === true) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { providers: [], error: "Identity service temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
