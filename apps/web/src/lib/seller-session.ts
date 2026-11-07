export type SellerSessionResult =
  | {
      status: "authenticated";
      partner: { id: string; email: string; name: string };
      org: { id: string; name: string; kind: "buyer" | "seller"; status: string } | null;
    }
  | { status: "unauthorized" }
  | { status: "unavailable"; message: string };
/** Only a definitive 401 ends the seller session; outages must not create login loops. */
export async function inspectSellerSession(
  request: (path: string) => Promise<Response>,
): Promise<SellerSessionResult> {
  try {
    const r = await request("/v1/partner/auth/me");
    if (r.status === 401) return { status: "unauthorized" };
    if (!r.ok)
      return {
        status: "unavailable",
        message:
          "The seller service is temporarily unavailable. Your session has been kept. Try again.",
      };
    const d = (await r.json()) as {
      partner?: { id: string; email: string; name: string };
      org?: { id: string; name: string; kind: "buyer" | "seller"; status: string } | null;
    };
    if (!d.partner?.id) throw Error("Invalid session response");
    return { status: "authenticated", partner: d.partner, org: d.org ?? null };
  } catch {
    return {
      status: "unavailable",
      message: "Could not reach the seller service. Check your connection and try again.",
    };
  }
}
