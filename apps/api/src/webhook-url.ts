/**
 * Webhook URL validation — blocks schemes and private/metadata targets
 * that would turn delivery into an SSRF primitive.
 *
 * Checked at registration and again immediately before each delivery attempt
 * (addresses DNS rebinding / URL edit races once store is mutable).
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
 * Returns a human-readable problem string, or null if the URL is acceptable.
 * In non-production, private targets are allowed so local demos keep working.
 */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Webhook URL is not a valid absolute URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Webhook URL must use http or https";
  }
  if (url.username || url.password) {
    return "Webhook URL must not include credentials";
  }
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const host = stripBrackets(url.hostname);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    METADATA_HOSTS.has(host) ||
    isBlockedIpv4(host) ||
    isBlockedIpv6(host)
  ) {
    return "Production webhooks cannot target localhost, private, or cloud-metadata addresses";
  }
  return null;
}
