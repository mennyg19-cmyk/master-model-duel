import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// Email provider behind one type (R-171 — Resend never leaks past this file).
// Modes from EMAIL_MODE (capture|mock|live). EMAIL_TEST_MODE=true forces capture
// even when live keys are set. Mock failure hooks: "+failonce" / "+failalways"
// in the recipient address.

export type EmailMessage = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  /** Plain text. The org's emails are text-first; branding wraps in dispatch. */
  body: string;
};

export type SendOutcome = { messageId: string };

export type EmailProvider = {
  mode: "resend" | "mock" | "capture";
  send(message: EmailMessage, attempt: number): Promise<SendOutcome>;
};

const RESEND_API = "https://api.resend.com";

function resendProvider(apiKey: string): EmailProvider {
  return {
    mode: "resend",
    async send(message) {
      const response = await fetch(`${RESEND_API}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject,
          text: message.body,
        }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!response.ok) {
        throw new Error(`Resend send failed (${response.status}): ${body?.message ?? "unknown error"}`);
      }
      return { messageId: body?.id ?? `resend_${randomBytes(8).toString("hex")}` };
    },
  };
}

function mockEmailProvider(): EmailProvider {
  return {
    mode: "mock",
    async send(message, attempt) {
      if (message.to.includes("+failonce") && attempt <= 1) {
        throw new Error("Mock provider failure (forced by +failonce recipient, first attempt)");
      }
      if (message.to.includes("+failalways")) {
        throw new Error("Mock provider failure (forced by +failalways recipient)");
      }
      return { messageId: `email_mock_${randomBytes(10).toString("hex")}` };
    },
  };
}

function captureEmailProvider(): EmailProvider {
  return {
    mode: "capture",
    send: async () => ({ messageId: `captured_${randomBytes(10).toString("hex")}` }),
  };
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    if (env.EMAIL_TEST_MODE || env.EMAIL_MODE === "capture") {
      provider = captureEmailProvider();
    } else if (env.EMAIL_MODE === "live") {
      if (!env.RESEND_API_KEY) {
        throw new Error("EMAIL_MODE=live requires RESEND_API_KEY");
      }
      provider = resendProvider(env.RESEND_API_KEY);
    } else {
      provider = mockEmailProvider();
    }
  }
  return provider;
}

/** Test hook — clears the memoized provider so the next call re-reads env. */
export function resetEmailProvider(): void {
  provider = null;
}
