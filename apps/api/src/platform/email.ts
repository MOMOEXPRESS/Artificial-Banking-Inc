/**
 * Outbound email for verification, invites, and password reset.
 *
 * Delivery backends (first configured wins):
 *   1. Brevo transactional HTTP API — `BREVO_API_KEY` (primary, free plan)
 *      Uses plain `fetch` (Node today; Cloudflare Workers-ready later).
 *      Free plan: verify one sender email — no custom domain required.
 *   2. Resend HTTP API — `RESEND_API_KEY` (optional fallback)
 *      Without a verified domain, Resend only delivers to the account owner.
 *   3. SMTP via nodemailer — `SMTP_URL` or `SMTP_HOST` (optional Node-only path)
 *
 * Email is required for production signup unless the explicitly named
 * testnet-only escape hatch `ABI_ALLOW_UNVERIFIED_SIGNUP=1` is set (refused
 * when CHAIN=base / mainnet).
 */

export type EmailProvider = "brevo" | "resend" | "smtp";

export type EmailSendResult =
  | { ok: true; provider: EmailProvider }
  | { ok: false; error: string; code: "NOT_CONFIGURED" | "DELIVERY_FAILED" };

export function resolveEmailProvider(): EmailProvider | null {
  if (process.env.BREVO_API_KEY?.trim()) return "brevo";
  if (process.env.RESEND_API_KEY?.trim()) return "resend";
  if (smtpConfigured()) return "smtp";
  return null;
}

export function emailDeliveryConfigured(): boolean {
  return resolveEmailProvider() !== null;
}

function smtpConfigured(): boolean {
  if (process.env.SMTP_URL?.trim()) return true;
  return Boolean(process.env.SMTP_HOST?.trim());
}

/**
 * Opt-in: allow signup without sending verification mail.
 * Default safe (off). Refused on mainnet (`CHAIN=base`).
 */
export function allowUnverifiedSignup(): boolean {
  if (process.env.ABI_ALLOW_UNVERIFIED_SIGNUP?.trim() !== "1") return false;
  if (process.env.CHAIN === "base") return false;
  return true;
}

/**
 * Console origin used in emailed links. Production must set ABI_CONSOLE_URL;
 * falling back to localhost would send unusable verification/invite links.
 */
export function resolveConsoleUrl(): { ok: true; url: string } | { ok: false; error: string } {
  const raw = process.env.ABI_CONSOLE_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { ok: false, error: "ABI_CONSOLE_URL must be an http(s) URL." };
      }
      return { ok: true, url: raw.replace(/\/$/, "") };
    } catch {
      return { ok: false, error: "ABI_CONSOLE_URL is not a valid URL." };
    }
  }
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[abi.email] ABI_CONSOLE_URL is unset in production — emailed links cannot be generated safely.",
    );
    return {
      ok: false,
      error:
        "ABI_CONSOLE_URL is required in production so verification and invite links point at the console.",
    };
  }
  return { ok: true, url: "http://localhost:3000" };
}

/** Parse `Name <addr@host>` or bare `addr@host` for provider APIs. */
export function parseFromAddress(raw: string): { name?: string; email: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*)<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]!.replace(/^["']|["']$/g, "").trim();
    return { ...(name ? { name } : {}), email: match[2]!.trim() };
  }
  return { email: trimmed };
}

function fromAddress(): string {
  return process.env.ABI_NOTIFY_EMAIL_FROM?.trim() || "ABI <onboarding@localhost>";
}

async function sendViaBrevo(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailSendResult> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: "BREVO_API_KEY is not set.",
    };
  }
  const from = parseFromAddress(fromAddress());
  if (!from.email.includes("@")) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error:
        "ABI_NOTIFY_EMAIL_FROM must be the Brevo-verified sender email (e.g. you@gmail.com or ABI <you@gmail.com>).",
    };
  }
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: from.email,
          ...(from.name ? { name: from.name } : {}),
        },
        to: [{ email: input.to }],
        subject: input.subject,
        textContent: input.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const message = `Brevo HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
      console.error("[abi.email] Brevo delivery failed:", message);
      return { ok: false, code: "DELIVERY_FAILED", error: message };
    }
    return { ok: true, provider: "brevo" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[abi.email] Brevo delivery failed:", message);
    return { ok: false, code: "DELIVERY_FAILED", error: message };
  }
}

async function sendViaResend(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: "RESEND_API_KEY is not set.",
    };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.ABI_NOTIFY_EMAIL_FROM ?? "ABI <onboarding@resend.dev>",
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const message = `Resend HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
      console.error("[abi.email] Resend delivery failed:", message);
      return { ok: false, code: "DELIVERY_FAILED", error: message };
    }
    return { ok: true, provider: "resend" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[abi.email] Resend delivery failed:", message);
    return { ok: false, code: "DELIVERY_FAILED", error: message };
  }
}

async function sendViaSmtp(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailSendResult> {
  // Lazy import — SMTP is Node-only and unused when Brevo/Resend are configured.
  const nodemailer = await import("nodemailer");
  const url = process.env.SMTP_URL?.trim();
  const transporter = url
    ? nodemailer.createTransport(url)
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST!.trim(),
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "1",
        auth:
          process.env.SMTP_USER?.trim() && process.env.SMTP_PASS
            ? {
                user: process.env.SMTP_USER.trim(),
                pass: process.env.SMTP_PASS,
              }
            : undefined,
      });

  try {
    await transporter.sendMail({
      from: fromAddress(),
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { ok: true, provider: "smtp" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[abi.email] SMTP delivery failed:", message);
    return { ok: false, code: "DELIVERY_FAILED", error: message };
  }
}

/**
 * Send mail through the first configured backend. Never throws.
 *
 * In `NODE_ENV=test`, returns NOT_CONFIGURED unless `ABI_EMAIL_TEST_SEND=1`
 * (used by provider-selection / fetch-mock tests).
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailSendResult> {
  if (process.env.NODE_ENV === "test" && process.env.ABI_EMAIL_TEST_SEND !== "1") {
    return { ok: false, code: "NOT_CONFIGURED", error: "Email disabled in test." };
  }
  const provider = resolveEmailProvider();
  if (provider === "brevo") return sendViaBrevo(input);
  if (provider === "resend") return sendViaResend(input);
  if (provider === "smtp") return sendViaSmtp(input);
  return {
    ok: false,
    code: "NOT_CONFIGURED",
    error:
      "Email is not configured. Set BREVO_API_KEY (recommended free path) or RESEND_API_KEY, " +
      "plus ABI_NOTIFY_EMAIL_FROM (verified sender) and ABI_CONSOLE_URL.",
  };
}
