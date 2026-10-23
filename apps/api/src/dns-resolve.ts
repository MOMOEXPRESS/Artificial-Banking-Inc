/**
 * Hostname → address resolution for outbound SSRF checks.
 *
 * Seam for PR #61: that branch uses `node:dns/promises.lookup`. On Cloudflare
 * Workers `node:dns` is incomplete, so the primary path is DNS-over-HTTPS
 * (Cloudflare 1.1.1.1). Node may still use `dns.promises.lookup` as a fallback
 * when DoH is unreachable and `ABI_RUNTIME` is not `cloudflare-workers`.
 */

export type ResolvedAddress = { address: string; family: 4 | 6 };

type DohAnswer = { name: string; type: number; data: string; TTL: number };
type DohResponse = { Status: number; Answer?: DohAnswer[] };

async function dohQuery(host: string, type: "A" | "AAAA"): Promise<string[]> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", host);
  url.searchParams.set("type", type);
  const res = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(`DoH HTTP ${res.status}`);
  }
  const body = (await res.json()) as DohResponse;
  if (body.Status !== 0) {
    throw new Error(`DoH status ${body.Status}`);
  }
  const answers = body.Answer ?? [];
  const want = type === "A" ? 1 : 28;
  return answers.filter((a) => a.type === want).map((a) => a.data);
}

async function nodeLookupAll(host: string): Promise<ResolvedAddress[]> {
  try {
    const dns = await import("node:dns/promises");
    const records = await dns.lookup(host, { all: true, verbatim: true });
    return records.map((r) => ({
      address: r.address,
      family: (r.family === 6 ? 6 : 4) as 4 | 6,
    }));
  } catch (error) {
    throw new Error(
      `node dns lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Resolve A/AAAA for `host`. Prefer DoH (Workers-safe); fall back to Node DNS
 * only outside the Workers runtime.
 */
export async function resolveHostAddresses(host: string): Promise<ResolvedAddress[]> {
  const name = host.replace(/\.$/, "").toLowerCase();
  try {
    const [v4, v6] = await Promise.all([
      dohQuery(name, "A").catch(() => [] as string[]),
      dohQuery(name, "AAAA").catch(() => [] as string[]),
    ]);
    const out: ResolvedAddress[] = [
      ...v4.map((address) => ({ address, family: 4 as const })),
      ...v6.map((address) => ({ address, family: 6 as const })),
    ];
    if (out.length > 0) return out;
    throw new Error("DoH returned no addresses");
  } catch (dohError) {
    if (process.env.ABI_RUNTIME === "cloudflare-workers") {
      throw dohError instanceof Error ? dohError : new Error(String(dohError));
    }
    return nodeLookupAll(name);
  }
}
