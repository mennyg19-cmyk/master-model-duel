import { env } from "@/lib/env";

// G-021: SMS dispatch module — the P9 notification channel's provider half.
// Twilio-class wrapper, SDK-isolated like lib/email/resend.ts: native fetch +
// basic auth cover the one call needed (create Message), so no twilio npm
// dependency. Without TWILIO_* the dispatcher captures SMS rows instead of
// calling this — same honesty class as the email capture mode.

export class SmsNotConfiguredError extends Error {
  constructor() {
    super("SMS delivery is not configured on this deployment yet (TWILIO_* missing)");
    this.name = "SmsNotConfiguredError";
  }
}

export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SmsSendError";
  }
}

interface SmsConfig {
  accountSid: string | null;
  authToken: string | null;
  fromNumber: string | null;
}

let smsConfigCache: SmsConfig | null = null;

export function getSmsConfig(): SmsConfig {
  if (!smsConfigCache) {
    smsConfigCache = {
      accountSid: env.TWILIO_ACCOUNT_SID ?? null,
      authToken: env.TWILIO_AUTH_TOKEN ?? null,
      fromNumber: env.TWILIO_FROM_NUMBER ?? null,
    };
  }
  return smsConfigCache;
}

export function isSmsConfigured(): boolean {
  const { accountSid, authToken, fromNumber } = getSmsConfig();
  return Boolean(accountSid && authToken && fromNumber);
}

export async function sendSms(input: { to: string; body: string }): Promise<{ id: string }> {
  const { accountSid, authToken, fromNumber } = getSmsConfig();
  if (!accountSid || !authToken || !fromNumber) throw new SmsNotConfiguredError();
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: input.to, From: fromNumber, Body: input.body }).toString(),
  });
  const body = (await response.json().catch(() => null)) as { sid?: string; message?: string } | null;
  if (!response.ok) {
    throw new SmsSendError(
      `Twilio send failed (${response.status}): ${body?.message ?? "unknown provider error"}`,
      response.status,
    );
  }
  if (!body?.sid) throw new SmsSendError("Twilio send failed (200): response carried no message sid", 200);
  return { id: body.sid };
}
