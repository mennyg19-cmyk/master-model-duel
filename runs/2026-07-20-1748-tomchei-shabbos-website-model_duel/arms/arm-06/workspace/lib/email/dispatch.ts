import { randomUUID } from "node:crypto";
import { OutboxMessage } from "@prisma/client";
import { DomainRuleError } from "@/lib/errors";
import { getResendConfig, sendEmail } from "@/lib/email/resend";
import { brandedFrom, EmailBranding, getEmailBranding } from "@/lib/email/render";
import { isSmsConfigured, sendSms } from "@/lib/notify/sms";

// R-178: the delivery driver behind the outbox. Two honest modes, decided per
// call from config — live (RESEND_API_KEY / TWILIO_* present) or capture
// (absent): capture marks the row SENT with a capture:* provider id and never
// touches a network, which is exactly what test mode means here (S5). The
// RESEND_BASE_URL fixture override is still "live" from the wrapper's seat —
// it exercises the real HTTP path against the dev double.

export interface DeliveryOutcome {
  providerId: string;
  captured: boolean;
}

// Branding does not change mid-send, so bulk callers (sweeper, campaign
// loop) fetch it once and pass it in rather than hitting the settings table
// per message; one-off callers leave it to the fallback fetch.
export async function deliverMessage(
  message: Pick<OutboxMessage, "channel" | "toAddress" | "subject" | "body">,
  branding?: EmailBranding,
): Promise<DeliveryOutcome> {
  if (message.channel === "SMS") {
    if (!isSmsConfigured()) {
      return { providerId: `capture:sms:${randomUUID()}`, captured: true };
    }
    const result = await sendSms({ to: message.toAddress, body: message.body });
    return { providerId: `twilio:${result.id}`, captured: false };
  }

  if (message.subject === null) {
    throw new DomainRuleError("EMAIL outbox row has no subject; every email producer sets subject at enqueue");
  }
  const { apiKey } = getResendConfig();
  if (!apiKey) {
    return { providerId: `capture:email:${randomUUID()}`, captured: true };
  }
  const brand = branding ?? (await getEmailBranding());
  const result = await sendEmail({
    to: message.toAddress,
    subject: message.subject,
    text: message.body,
    from: brandedFrom(brand),
    replyTo: brand.replyToEmail,
  });
  return { providerId: `resend:${result.id}`, captured: false };
}

// Settings Email tab + smoke honesty: which driver a send would use right
// now. "fixture" is live mode pointed at the in-app dev double.
export function currentDeliveryMode(): { email: "live" | "fixture" | "capture"; sms: "live" | "capture" } {
  const { apiKey, baseUrl } = getResendConfig();
  const email = !apiKey ? "capture" : baseUrl.includes("/api/dev/email-fixture") ? "fixture" : "live";
  return { email, sms: isSmsConfigured() ? "live" : "capture" };
}
