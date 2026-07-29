import { env } from "@/lib/env";

// R-171: the Resend sender, SDK-isolated in one module. ponytail ladder —
// native fetch covers the single call P11 needs (POST /emails), so the resend
// npm package is not a dependency. Every outbound email in the system goes
// through sendEmail() here; nothing else knows the provider's wire shape.

export class ResendNotConfiguredError extends Error {
  constructor() {
    super("Email delivery is not configured on this deployment yet (RESEND_API_KEY missing)");
    this.name = "ResendNotConfiguredError";
  }
}

export class ResendSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ResendSendError";
  }
}

interface ResendConfig {
  apiKey: string | null;
  baseUrl: string;
}

let resendConfigCache: ResendConfig | null = null;

export function getResendConfig(): ResendConfig {
  if (!resendConfigCache) {
    resendConfigCache = {
      apiKey: env.RESEND_API_KEY ?? null,
      baseUrl: (env.RESEND_BASE_URL ?? "https://api.resend.com").replace(/\/+$/, ""),
    };
  }
  return resendConfigCache;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  from: string;
  replyTo?: string;
}

// Returns the provider message id. Throws ResendNotConfiguredError when no
// key exists (the dispatcher captures instead of calling this), and
// ResendSendError on any provider rejection — the sweeper records that as the
// retryable failure trail.
export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const { apiKey, baseUrl } = getResendConfig();
  if (!apiKey) throw new ResendNotConfiguredError();
  const response = await fetch(`${baseUrl}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: [input.replyTo] } : {}),
    }),
  });
  const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok) {
    throw new ResendSendError(
      `Resend send failed (${response.status}): ${body?.message ?? "unknown provider error"}`,
      response.status,
    );
  }
  if (!body?.id) throw new ResendSendError("Resend send failed (200): response carried no message id", 200);
  return { id: body.id };
}
