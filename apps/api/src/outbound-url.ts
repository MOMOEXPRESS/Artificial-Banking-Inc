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
 * Previously only webhooks were guarded, while `pay_api` fetched agent-supplied
 * URLs unchecked — and the shipped `api_seller` policy template allowlisted
 * `localhost`, so an agent could drive requests into the server's own network.
 */

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
function isBlockedIpv4(host: string): boolean {
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
  if (a === 255) return true;
  return false;
}

/** True for IPv6 literals (incl. IPv4-mapped) that must be blocked. */
function isBlockedIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("fe80:")) return true; // link-local
  // IPv4-mapped ::ffff:a.b.c.d
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (mapped && isBlockedIpv4(mapped[1]!)) return true;
  // Compressed forms that embed 127.0.0.1 etc. as hex are rare; block loopback prefix.
  if (h === "0:0:0:0:0:0:0:1" || h.endsWith(":0:0:0:0:0:0:1")) return true;
  return false;
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
    isBlockedIpv4(host) ||
    isBlockedIpv6(host);

  if (!isPrivate) return null;
  // Cloud metadata is never acceptable, even in development: a leaked instance
  // credential is not a local-convenience trade worth making.
  if (METADATA_HOSTS.has(host) || (host === "169.254.169.254")) {
    return `${label} cannot target a cloud metadata endpoint`;
  }
  if (localSellersAllowed()) return null;
  return `${label} cannot target localhost, private, or cloud-metadata addresses`;
}

/** Webhook-specific wrapper — same rules, caller-appropriate wording. */
export function webhookUrlProblem(raw: string): string | null {
  return outboundUrlProblem(raw, "Webhook URL");
}
