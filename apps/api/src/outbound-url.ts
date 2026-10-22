/**
 * Outbound URL validation — blocks schemes and private/metadata targets that
 * would turn a server-side fetch into an SSRF primitive.
 *
 * Used by **every** path where a caller influences a URL this process will
 * request:
 *   - webhook registration, and again immediately before each delivery attempt
 *     (closes DNS-rebinding / URL-edit races)
 *   - the x402 rail, where an agent supplies the seller URL
 *
 * Checks cover literal IPs (incl. IPv4-mapped IPv6 in both dotted and hex
 * WHATWG forms), reserved ranges (CGNAT, benchmarking 198.18/15, multicast),
 * and — when `resolveAndPin` is used — every address DNS returns, with the
 * request pinned to a verified public IP.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, "").toLowerCase();
}

/** True for IPv4 literals that must never be webhook targets in production. */
export function isBlockedIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Decode an IPv4-mapped IPv6 address (`::ffff:a.b.c.d` or WHATWG hex
 * `::ffff:7f00:1`) into dotted-quad form, or null if not mapped.
 */
export function ipv4MappedToDotted(host: string): string | null {
  const h = host.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/** True for IPv6 literals (incl. IPv4-mapped) that must be blocked. */
export function isBlockedIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("ff")) return true; // multicast
  const mapped = ipv4MappedToDotted(h);
  if (mapped && isBlockedIpv4(mapped)) return true;
  if (h === "0:0:0:0:0:0:0:1" || h.endsWith(":0:0:0:0:0:0:1")) return true;
  return false;
}

function isBlockedIpLiteral(host: string): boolean {
  const family = isIP(host);
  if (family === 4) return isBlockedIpv4(host);
  if (family === 6) return isBlockedIpv6(host);
  // isIP does not always accept IPv4-mapped forms that WHATWG still serializes.
  if (host.includes(":")) return isBlockedIpv6(host);
  return isBlockedIpv4(host);
}

/**
 * Whether this process may talk to loopback / private addresses.
 *
 * True in development so the bundled x402 seller and local webhook receivers
 * keep working. In production it requires an explicit opt-in, because it is the
 * switch that turns an agent-supplied URL into an internal network probe.
 */
export function localSellersAllowed(): boolean {
  if (process.env.ABI_ALLOW_LOCAL_TARGETS === "1") return true;
  if (process.env.ABI_ALLOW_LOCAL_TARGETS === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * Returns a human-readable problem string, or null if the URL is acceptable.
 *
 * `label` names the caller so the message is actionable ("Webhook URL…" vs
 * "Payment destination…").
 */
export function outboundUrlProblem(raw: string, label = "Outbound URL"): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${label} is not a valid absolute URL`;
  }
  if (url.protocol === "abi:" && url.hostname === "demo-inbox") {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `${label} must use http or https`;
  }
  if (url.username || url.password) {
    return `${label} must not include credentials`;
  }

  const host = stripBrackets(url.hostname);
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    METADATA_HOSTS.has(host) ||
    isBlockedIpLiteral(host);

  if (!isPrivate) return null;
  // Cloud metadata is never acceptable, even in development: a leaked instance
  // credential is not a local-convenience trade worth making.
  if (METADATA_HOSTS.has(host) || host === "169.254.169.254" || ipv4MappedToDotted(host) === "169.254.169.254") {
    return `${label} cannot target a cloud metadata endpoint`;
  }
  if (localSellersAllowed()) return null;
  return `${label} cannot target localhost, private, or cloud-metadata addresses`;
}

/** Webhook-specific wrapper — same rules, caller-appropriate wording. */
export function webhookUrlProblem(raw: string): string | null {
  return outboundUrlProblem(raw, "Webhook URL");
}

export type PinnedOutboundUrl = {
  /** Original absolute URL (unchanged for Host header / TLS SNI). */
  url: string;
  /** Verified public IP to dial (empty when local targets are allowed). */
  pinnedIp?: string;
};

/**
 * Resolve DNS, reject if any answer is private/metadata, and return a pinned IP
 * for the caller to dial. Literal-IP hosts are checked without DNS.
 *
 * Callers that want rebinding protection should prefer this over a bare
 * `outboundUrlProblem` check before `fetch`.
 */
export async function resolveAndPinOutboundUrl(
  raw: string,
  label = "Outbound URL",
): Promise<{ ok: true; pinned: PinnedOutboundUrl } | { ok: false; problem: string }> {
  const problem = outboundUrlProblem(raw, label);
  if (problem) return { ok: false, problem };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: `${label} is not a valid absolute URL` };
  }
  if (url.protocol === "abi:") {
    return { ok: true, pinned: { url: raw } };
  }

  const host = stripBrackets(url.hostname);
  if (isIP(host) || host.includes(":")) {
    if (isBlockedIpLiteral(host) && !localSellersAllowed()) {
      return {
        ok: false,
        problem: `${label} cannot target localhost, private, or cloud-metadata addresses`,
      };
    }
    return { ok: true, pinned: { url: raw, pinnedIp: host } };
  }

  if (host === "localhost" || host.endsWith(".localhost")) {
    if (!localSellersAllowed()) {
      return {
        ok: false,
        problem: `${label} cannot target localhost, private, or cloud-metadata addresses`,
      };
    }
    return { ok: true, pinned: { url: raw } };
  }

  let records: { address: string; family: number }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch (e) {
    return {
      ok: false,
      problem: `${label} hostname could not be resolved (${
        e instanceof Error ? e.message : String(e)
      })`,
    };
  }
  if (records.length === 0) {
    return { ok: false, problem: `${label} hostname resolved to no addresses` };
  }

  for (const rec of records) {
    if (isBlockedIpLiteral(rec.address)) {
      if (localSellersAllowed() && !METADATA_HOSTS.has(host)) {
        continue;
      }
      return {
        ok: false,
        problem: `${label} resolves to a blocked address (${rec.address})`,
      };
    }
  }

  const publicRecords = records.filter((r) => !isBlockedIpLiteral(r.address));
  const chosen = (publicRecords[0] ?? records[0])!;
  return { ok: true, pinned: { url: raw, pinnedIp: chosen.address } };
}
