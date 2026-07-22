import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// SMS provider behind one type (G-021 channel wiring). Modes from SMS_MODE
// (capture|mock|live). EMAIL_TEST_MODE=true forces capture (same switch as
// email — documented single capture override). Twilio is the only live backend.

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
      // Forced-failure hooks keyed on body (phone numbers can't carry tags).
      if (message.body.includes("[failonce]") && attempt <= 1) {
        throw new Error("Mock SMS failure (forced by [failonce] marker, first attempt)");
      }
      if (message.body.includes("[failalways]")) {
        throw new Error("Mock SMS failure (forced by [failalways] marker)");
      }
      return { messageId: `sms_mock_${randomBytes(10).toString("hex")}` };
    },
  };
}

function captureSmsProvider(): SmsProvider {
  return {
    mode: "capture",
    send: async () => ({ messageId: `captured_${randomBytes(10).toString("hex")}` }),
  };
}

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (!provider) {
    if (env.EMAIL_TEST_MODE || env.SMS_MODE === "capture") {
      provider = captureSmsProvider();
    } else if (env.SMS_MODE === "live") {
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
        throw new Error("SMS_MODE=live requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER");
      }
      provider = twilioProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER);
    } else {
      provider = mockSmsProvider();
    }
  }
  return provider;
}

/** Test hook — clears the memoized provider so the next call re-reads env. */
export function resetSmsProvider(): void {
  provider = null;
}
