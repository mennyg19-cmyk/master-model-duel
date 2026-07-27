import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// SMS provider behind one type (G-021 channel wiring). Twilio-class REST over
// fetch when the three TWILIO_* vars are set; otherwise the same mock/capture
// split as the email provider, so the P9 notification rows with channel SMS
// dispatch through identical code either way. Provider stays swappable — this
// file is the only place that knows it's Twilio.

export type SmsMessage = { to: string; body: string };

export type SmsProvider = {
  mode: "twilio" | "mock" | "capture";
  send(message: SmsMessage, attempt: number): Promise<{ messageId: string }>;
};

function twilioProvider(accountSid: string, authToken: string, fromNumber: string): SmsProvider {
  return {
    mode: "twilio",
    async send(message) {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: message.to, From: fromNumber, Body: message.body }).toString(),
        }
      );
      const body = (await response.json().catch(() => null)) as { sid?: string; message?: string } | null;
      if (!response.ok) {
        throw new Error(`Twilio send failed (${response.status}): ${body?.message ?? "unknown error"}`);
      }
      return { messageId: body?.sid ?? `twilio_${randomBytes(8).toString("hex")}` };
    },
  };
}

function mockSmsProvider(): SmsProvider {
  return {
    mode: "mock",
    async send(message, attempt) {
      // Same forced-failure hooks as email, keyed on the body since phone
      // numbers can't carry tags: "[failonce]" fails the first attempt only.
      if (message.body.includes("[failonce]") && attempt <= 1) {
        throw new Error("Mock SMS failure (forced by [failonce] marker, first attempt)");
      }
      return { messageId: `sms_mock_${randomBytes(10).toString("hex")}` };
    },
  };
}

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (!provider) {
    provider = env.EMAIL_TEST_MODE
      ? { mode: "capture", send: async () => ({ messageId: `captured_${randomBytes(10).toString("hex")}` }) }
      : env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER
        ? twilioProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER)
        : mockSmsProvider();
  }
  return provider;
}
