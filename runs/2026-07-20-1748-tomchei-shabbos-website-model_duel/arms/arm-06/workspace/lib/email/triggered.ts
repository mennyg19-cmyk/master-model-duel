import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { brandTokens, getEmailBranding, renderTemplate, RenderTokens } from "@/lib/email/render";

// R-086/R-178: triggered/transactional email registry. Coded defaults below
// are the fallback copy; the seeded EmailTemplate rows mirror them so staff
// see real content in the Templates tab, and the EmailTriggeredOverride row
// per key controls enable/disable + subject/body/template overrides.
// Resolution order: bodyTemplateOverride > linked template > coded default.
export const TRIGGERED_KEYS = ["order_confirmation", "payment_link", "refund_issued", "subscription_manage"] as const;
export type TriggeredKey = (typeof TRIGGERED_KEYS)[number];

export const TRIGGERED_DEFAULTS: Record<TriggeredKey, { name: string; subject: string; bodyText: string }> = {
  order_confirmation: {
    name: "Order confirmation",
    subject: "{{brand}} order {{orderRef}} — thank you",
    bodyText:
      "Hello {{customerName}},\n\nThank you for your {{brand}} order {{orderRef}} (total {{amount}}). We will take it from here — you will hear from us as your packages move.\n\n{{footer}}",
  },
  payment_link: {
    name: "Payment link",
    subject: "{{brand}}: balance due on order {{orderRef}}",
    bodyText:
      "Hello {{customerName}},\n\nYour {{brand}} order {{orderRef}} has an outstanding balance of {{amount}}. You can view and pay your order here:\n{{payUrl}}\n\nThank you for supporting {{brand}}.\n\n{{footer}}",
  },
  refund_issued: {
    name: "Refund issued",
    subject: "{{brand}}: refund issued for order {{orderRef}}",
    bodyText:
      "Hello {{customerName}},\n\nA refund of {{amount}} was issued for your {{brand}} order {{orderRef}}. The card statement can take a few days to show it.\n\n{{footer}}",
  },
  subscription_manage: {
    name: "Subscription manage link",
    subject: "Manage your {{brand}} emails",
    bodyText:
      "Hello {{customerName}},\n\nYou are subscribed to {{brand}} updates. Manage your preferences or unsubscribe anytime with this personal link:\n{{manageUrl}}\n\n{{footer}}",
  },
};

export type EnqueueResult =
  | { status: "queued"; outboxId: string }
  | { status: "disabled" };

export interface TriggeredInput {
  key: TriggeredKey;
  recipient: string;
  tokens: RenderTokens;
  orderId?: string;
  metadata?: Prisma.InputJsonValue;
}

// Enqueues one EMAIL outbox row for a triggered key, honoring the per-key
// override. Disabled keys write nothing and report "disabled" so the caller
// can audit the suppression. Runs inside the caller's transaction when one is
// passed (order finalize/refund), so the email commit is atomic with the
// domain event it records.
export async function enqueueTriggeredEmail(
  input: TriggeredInput,
  tx?: Prisma.TransactionClient,
): Promise<EnqueueResult> {
  const client = tx ?? prisma;
  const [override, branding] = await Promise.all([
    client.emailTriggeredOverride.findUnique({
      where: { key: input.key },
      include: { template: true },
    }),
    getEmailBranding(),
  ]);
  if (override && !override.enabled) return { status: "disabled" };

  const defaults = TRIGGERED_DEFAULTS[input.key];
  const subjectTemplate = override?.subjectOverride ?? override?.template?.subject ?? defaults.subject;
  const bodyTemplate = override?.bodyTemplateOverride ?? override?.template?.bodyText ?? defaults.bodyText;
  const tokens = brandTokens(branding, input.tokens);

  const row = await client.outboxMessage.create({
    data: {
      kind: input.key,
      channel: "EMAIL",
      toAddress: input.recipient,
      subject: renderTemplate(subjectTemplate, tokens),
      body: renderTemplate(bodyTemplate, tokens),
      orderId: input.orderId ?? null,
      metadata: input.metadata ?? Prisma.DbNull,
    },
  });
  return { status: "queued", outboxId: row.id };
}
