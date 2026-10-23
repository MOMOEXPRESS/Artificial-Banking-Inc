/**
 * Outbound email for verification, invites, and password reset.
 *
 * Delivery backends (first match wins):
 *   1. SMTP via nodemailer — `SMTP_URL` or `SMTP_HOST` (+ user/pass)
 *      Free options that deliver to arbitrary recipients: Gmail app password,
 *      Brevo free SMTP, Mailgun/Elastic Email free tiers, etc.
 *   2. Resend HTTP API — `RESEND_API_KEY`
 *      Free tier without a verified domain only delivers to the Resend account
 *      owner's address; not enough for open signup.
 *
 * Email is required for production signup unless the explicitly named
 * testnet-only escape hatch `ABI_ALLOW_UNVERIFIED_SIGNUP=1` is set (refused
 * when CHAIN=base / mainnet).
 */
import nodemailer from "nodemailer";

export type EmailSendResult =
  | { ok: true; provider: "smtp" | "resend" }
  | { ok: false; error: string; code: "NOT_CONFIGURED" | "DELIVERY_FAILED" };

export function emailDeliveryConfigured(): boolean {
  return Boolean(smtpConfigured() || process.env.RESEND_API_KEY?.trim());
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

function fromAddress(): string {
  return process.env.ABI_NOTIFY_EMAIL_FROM?.trim() || "ABI <onboarding@localhost>";
}

async function sendViaSmtp(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailSendResult> {
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
      error: "No email delivery backend is configured.",
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

/** Send mail through the first configured backend. Never throws. */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailSendResult> {
  if (process.env.NODE_ENV === "test") {
    return { ok: false, code: "NOT_CONFIGURED", error: "Email disabled in test." };
  }
  if (smtpConfigured()) return sendViaSmtp(input);
  if (process.env.RESEND_API_KEY?.trim()) return sendViaResend(input);
  return {
    ok: false,
    code: "NOT_CONFIGURED",
    error:
      "Email is not configured. Set SMTP_URL (or SMTP_HOST/SMTP_USER/SMTP_PASS) or RESEND_API_KEY, plus ABI_NOTIFY_EMAIL_FROM and ABI_CONSOLE_URL.",
  };
}
