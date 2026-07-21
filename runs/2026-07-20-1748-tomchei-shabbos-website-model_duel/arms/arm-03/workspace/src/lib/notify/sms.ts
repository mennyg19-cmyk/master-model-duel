import { randomBytes } from "node:crypto";

export type SmsMode = "capture" | "mock" | "live";

export type SmsSendInput = {
  to: string;
  body: string;
};

export type SmsSendResult = {
  ok: boolean;
  providerId?: string;
  error?: string;
  captured?: boolean;
};

export function getSmsMode(): SmsMode {
  const mode = (process.env.SMS_MODE ?? "").trim().toLowerCase();
  if (mode === "live") return "live";
  if (mode === "mock") return "mock";
  if (mode === "capture") return "capture";
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  if (!sid || sid.includes("mock")) return "capture";
  return "live";
}

/** Twilio-class SMS dispatch (G-021) — isolated; capture/mock by default. */
export async function smsSend(input: SmsSendInput): Promise<SmsSendResult> {
  const mode = getSmsMode();
  if (mode === "capture") {
    return {
      ok: true,
      captured: true,
      providerId: `sms_cap_${randomBytes(8).toString("hex")}`,
    };
  }
  if (mode === "mock") {
    return {
      ok: true,
      providerId: `sms_mock_${randomBytes(8).toString("hex")}`,
    };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM?.trim();
  if (!sid || !token || !from) {
    return { ok: false, error: "Twilio credentials are not configured" };
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const body = new URLSearchParams({
    To: input.to,
    From: from,
    Body: input.body,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json().catch(() => null)) as {
    sid?: string;
    message?: string;
  } | null;
  if (!res.ok) {
    return { ok: false, error: json?.message || `Twilio HTTP ${res.status}` };
  }
  return { ok: true, providerId: json?.sid };
}
