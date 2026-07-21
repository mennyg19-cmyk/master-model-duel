import { randomBytes } from "node:crypto";
import { getSetting } from "@/lib/settings";

export type EmailMode = "capture" | "mock" | "live";

export type ResendSendInput = {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
};

export type ResendSendResult = {
  ok: boolean;
  providerId?: string;
  error?: string;
  captured?: boolean;
};

const EMAIL_SETTINGS = {
  forceFail: "email.providerForceFail",
} as const;

export function getEmailMode(): EmailMode {
  const mode = (process.env.EMAIL_MODE ?? "").trim().toLowerCase();
  if (mode === "live") return "live";
  if (mode === "mock") return "mock";
  if (mode === "capture") return "capture";
  const key = process.env.RESEND_API_KEY ?? "";
  if (!key || key.includes("mock")) return "capture";
  return "live";
}

export async function isProviderForceFail(): Promise<boolean> {
  const setting = await getSetting<{ enabled?: boolean }>(EMAIL_SETTINGS.forceFail);
  if (setting?.enabled) return true;
  return (process.env.EMAIL_FORCE_FAIL ?? "").trim() === "1";
}

export { EMAIL_SETTINGS };

/** Isolated Resend sender (R-171) — fetch-based; no SDK package. */
export async function resendSend(input: ResendSendInput): Promise<ResendSendResult> {
  const mode = getEmailMode();
  if (await isProviderForceFail()) {
    return { ok: false, error: "Forced provider failure (test hook)" };
  }

  if (mode === "capture") {
    return {
      ok: true,
      captured: true,
      providerId: `cap_${randomBytes(8).toString("hex")}`,
    };
  }

  if (mode === "mock") {
    return {
      ok: true,
      captured: true,
      providerId: `mock_${randomBytes(8).toString("hex")}`,
    };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });

  const json = (await res.json().catch(() => null)) as {
    id?: string;
    message?: string;
  } | null;

  if (!res.ok) {
    return {
      ok: false,
      error: json?.message || `Resend HTTP ${res.status}`,
    };
  }

  return { ok: true, providerId: json?.id ?? `resend_${randomBytes(6).toString("hex")}` };
}

export function defaultFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || "noreply@tomchei.local";
}
