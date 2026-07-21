import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Triggered-email registry (R-086, R-178): defaults live here in code; an
// EmailTemplate row stores only what a manager overrode (subject/body) and
// whether the key is enabled. Placeholders are {{name}} tokens — unknown
// tokens render as-is so a typo is visible in the test capture, not silent.

export type TemplateKey = keyof typeof TEMPLATE_DEFAULTS;

export const TEMPLATE_DEFAULTS = {
  order_confirmation: {
    label: "Order confirmation",
    subject: "Order #{{orderNumber}} confirmed — {{orgName}}",
    body:
      "{{customerName}}, thank you! Order #{{orderNumber}} is confirmed.\n\n" +
      "Total: {{total}}\nRecipients: {{recipientCount}}\n\n" +
      // Note: DB-bound template text must stay WIN1252-safe (the embedded dev
      // Postgres client encoding) — no arrows or exotic symbols here.
      "You can review it any time under Account > Orders.",
    placeholders: ["orgName", "customerName", "orderNumber", "total", "recipientCount"],
  },
  payment_link: {
    label: "Payment link (unpaid order)",
    subject: "Payment due for order #{{orderNumber}} — {{orgName}}",
    body:
      "{{customerName}}, order #{{orderNumber}} has an open balance of {{owed}}.\n\n" +
      "Review the order and payment options here: {{orderUrl}}",
    placeholders: ["orgName", "customerName", "orderNumber", "owed", "orderUrl"],
  },
  refund_notice: {
    label: "Refund issued",
    subject: "Refund issued for order #{{orderNumber}} — {{orgName}}",
    body:
      "{{customerName}}, we refunded {{amount}} on order #{{orderNumber}}.\n\n" +
      "It should appear on your statement within a few business days.",
    placeholders: ["orgName", "customerName", "orderNumber", "amount"],
  },
  test_email: {
    label: "Settings test email",
    subject: "Test email from {{orgName}}",
    body: "This is a test email sent from the admin settings page. Delivery wiring works.",
    placeholders: ["orgName"],
  },
} as const;

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_DEFAULTS) as TemplateKey[];

export function isTemplateKey(key: string): key is TemplateKey {
  return key in TEMPLATE_DEFAULTS;
}

export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (token, name: string) => values[name] ?? token);
}

export type ResolvedTemplate = { subject: string; body: string; isEnabled: boolean };

/** Defaults merged with the key's DB override row (per-key overrides, R-086). */
export async function resolveTemplate(
  key: TemplateKey,
  tx: Prisma.TransactionClient = db
): Promise<ResolvedTemplate> {
  const override = await tx.emailTemplate.findUnique({ where: { key } });
  return {
    subject: override?.subject ?? TEMPLATE_DEFAULTS[key].subject,
    body: override?.body ?? TEMPLATE_DEFAULTS[key].body,
    isEnabled: override?.isEnabled ?? true,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
