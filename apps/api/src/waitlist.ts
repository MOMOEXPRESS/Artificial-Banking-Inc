/**
 * Public waitlist.
 *
 *   POST /v1/public/waitlist            no auth; { email, source?, referrer?, website? }
 *   GET  /v1/guardian/waitlist/access   { allowed } — drives the console nav item
 *   GET  /v1/guardian/waitlist          total + entries (waitlist admins only)
 *   GET  /v1/guardian/waitlist.csv      CSV export   (waitlist admins only)
 *
 * The join answers the same way whether the email is new, already listed, or
 * caught by the honeypot, so it cannot be used to test who signed up. A new
 * signup alerts the operator by email (capped per hour); the alert never
 * blocks or fails the join.
 *
 * The list is global (not org data), so "owner" is not enough to read it: the
 * caller must be an org owner whose verified email is a waitlist admin
 * (ABI_WAITLIST_ADMINS, else the alert recipient).
 */
import type express from "express";
import { z } from "zod";
import { hashSecret } from "./secrets.js";
import { parseFromAddress, sendEmail } from "./platform/email.js";
import { store, type OrgRow } from "./store.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

type GuardianCtxLike = { role: string; via: string; user?: { email: string } };

export const WAITLIST_JOINED = {
  ok: true,
  message: "You're on the list. We'll email you when there's a spot.",
} as const;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Lowercased, trimmed email, or null when it is not a plausible address. */
export function normalizeWaitlistEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at > 64) return null;
  if (!EMAIL_RE.test(email) || email.includes("..")) return null;
  return email;
}

function cleanText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return v ? v.slice(0, max) : undefined;
}

// ------------------------------------------------------------- rate limit

const ipHits = new Map<string, number[]>();
const MAX_IPS = 20_000;

function joinsPerHour(): number {
  const n = Number(process.env.ABI_WAITLIST_LIMIT_PER_HOUR ?? 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/** Sliding one-hour window per client IP. True when over the limit. */
export function waitlistRateLimited(ip: string, now = Date.now()): boolean {
  const hits = (ipHits.get(ip) ?? []).filter((t) => t > now - 3_600_000);
  hits.push(now);
  if (!ipHits.has(ip) && ipHits.size >= MAX_IPS) {
    const oldest = ipHits.keys().next().value;
    if (oldest !== undefined) ipHits.delete(oldest);
  }
  ipHits.set(ip, hits);
  return hits.length > joinsPerHour();
}

export function __resetWaitlistRateLimitForTests(): void {
  ipHits.clear();
}

// ------------------------------------------------------------ owner alert

/** Who is told about new signups. */
export function waitlistNotifyTo(): string | null {
  const explicit = process.env.ABI_WAITLIST_NOTIFY_TO?.trim();
  if (explicit) return explicit;
  const from = process.env.ABI_NOTIFY_EMAIL_FROM?.trim();
  if (!from) return null;
  const { email } = parseFromAddress(from);
  return email.includes("@") ? email : null;
}

/** Verified emails allowed to read the list. */
export function waitlistAdminEmails(): string[] {
  const raw = process.env.ABI_WAITLIST_ADMINS?.trim() || waitlistNotifyTo() || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

function alertsPerHour(): number {
  const n = Number(process.env.ABI_WAITLIST_NOTIFY_PER_HOUR ?? 50);
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

/**
 * Email the operator about one new signup. Never throws. The per-hour cap is
 * counted in the database, so it holds across processes and restarts.
 */
export async function alertNewWaitlistSignup(id: number, email: string): Promise<string> {
  try {
    const to = waitlistNotifyTo();
    if (!to) {
      store.markWaitlistNotify(id, "not_configured");
      return "not_configured";
    }
    const since = new Date(Date.now() - 3_600_000).toISOString();
    if (store.countWaitlistNotifiedSince(since) >= alertsPerHour()) {
      store.markWaitlistNotify(id, "capped");
      return "capped";
    }
    const total = store.countWaitlist();
    const result = await sendEmail({
      to,
      subject: `New ABI waitlist signup: ${email}`,
      text:
        `${email} joined the ABI waitlist.\n\n` +
        `Total on the waitlist: ${total}\n\n` +
        `See and export the list in the console: Waitlist (owner only).\n` +
        `Alerts are capped at ${alertsPerHour()} per hour.`,
    });
    const status = result.ok ? "sent" : `failed:${result.code}`;
    store.markWaitlistNotify(id, status);
    return status;
  } catch (e) {
    const status = `failed:${e instanceof Error ? e.message : "error"}`;
    try {
      store.markWaitlistNotify(id, status);
    } catch {
      /* never fail the join */
    }
    return status;
  }
}

// ----------------------------------------------------------------- routes

function isWaitlistAdmin(org: OrgRow, req: express.Request): boolean {
  const ctx = (req as express.Request & { guardianCtx?: GuardianCtxLike }).guardianCtx;
  if (!ctx || ctx.role !== "owner") return false;
  const admins = waitlistAdminEmails();
  if (admins.length === 0) return false;
  if (ctx.via === "session" && ctx.user?.email) {
    const email = ctx.user.email.toLowerCase();
    return admins.includes(email) && store.isVerifiedUserEmail(email);
  }
  // Owner guardian key: the org's verified owner must be an admin.
  return store.orgVerifiedOwnerEmails(org.id).some((e) => admins.includes(e));
}

function csvCell(v: string | undefined): string {
  const s = v ?? "";
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function waitlistCsv(rows: ReturnType<typeof store.listWaitlist>): string {
  const lines = ["email,joined_at,source,referrer"];
  for (const r of rows) {
    lines.push([r.email, r.createdAt, r.source, r.referrer].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function registerWaitlistRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  app.post("/v1/public/waitlist", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ip = req.ip ?? "anon";
    if (waitlistRateLimited(ip)) {
      return res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many attempts. Try again in an hour." },
      });
    }
    // Honeypot: humans never see this field. Answer exactly like a success.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return res.json(WAITLIST_JOINED);
    }
    const email = normalizeWaitlistEmail(body.email);
    if (!email) {
      return res.status(400).json({
        error: { code: "INVALID_EMAIL", message: "Enter a valid email address." },
      });
    }
    const joined = store.joinWaitlist({
      email,
      source: cleanText(body.source, 64),
      referrer: cleanText(body.referrer, 512) ?? cleanText(req.get("referer"), 512),
      ipHash: hashSecret(`waitlist-ip:${ip}`),
    });
    if (joined.created) {
      // Fire and forget: the alert can never block or fail the join.
      void alertNewWaitlistSignup(joined.id, email);
    }
    res.json(WAITLIST_JOINED);
  });

  app.get(
    "/v1/guardian/waitlist/access",
    guardianRoute((org, req, res) => {
      res.json({ allowed: isWaitlistAdmin(org, req) });
    }),
  );

  app.get(
    "/v1/guardian/waitlist",
    guardianRoute(
      (org, req, res) => {
        if (!isWaitlistAdmin(org, req)) {
          return res.status(403).json({
            error: { code: "FORBIDDEN", message: "The waitlist is visible to its admins only." },
          });
        }
        const q = z
          .object({
            limit: z.coerce.number().int().min(1).max(1000).default(200),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .parse(req.query);
        res.json({
          total: store.countWaitlist(),
          entries: store.listWaitlist(q).map((r) => ({
            email: r.email,
            createdAt: r.createdAt,
            source: r.source ?? null,
            referrer: r.referrer ?? null,
            notifyStatus: r.notifyStatus ?? null,
          })),
          limit: q.limit,
          offset: q.offset,
        });
      },
      { ownerOnly: true },
    ),
  );

  app.get(
    "/v1/guardian/waitlist.csv",
    guardianRoute(
      (org, req, res) => {
        if (!isWaitlistAdmin(org, req)) {
          return res.status(403).json({
            error: { code: "FORBIDDEN", message: "The waitlist is visible to its admins only." },
          });
        }
        const day = new Date().toISOString().slice(0, 10);
        res
          .status(200)
          .set("content-type", "text/csv; charset=utf-8")
          .set("content-disposition", `attachment; filename="abi-waitlist-${day}.csv"`)
          .set("cache-control", "no-store")
          .send(waitlistCsv(store.listWaitlist({ limit: 10_000 })));
      },
      { ownerOnly: true },
    ),
  );
}
