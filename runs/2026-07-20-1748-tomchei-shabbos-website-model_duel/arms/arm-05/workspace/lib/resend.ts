export type OutboundEmail = {
  recipient: string;
  subject: string;
  html: string;
  idempotencyKey?: string;
};

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendThroughResend(email: OutboundEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is required to send live email.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "Tomchei Shabbos <noreply@example.test>",
      to: [email.recipient],
      subject: email.subject,
      html: email.html,
    }),
  });
  const body = await response.json() as { id?: string; message?: string };
  if (!response.ok || !body.id) throw new Error(body.message ?? "Resend rejected the email.");
  return body.id;
}
