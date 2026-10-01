/** Direct, recipient-addressed mail delivery through the configured Resend API. */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  if (process.env.NODE_ENV === "test") return false;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;
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
  if (!response.ok) throw new Error(`Email delivery failed (${response.status}).`);
  return true;
}
