export const TRIGGERED_KEYS = [
  "order.confirmation",
  "order.payment_link",
  "order.refund",
] as const;

export type TriggeredKey = (typeof TRIGGERED_KEYS)[number];

export const DEFAULT_TEMPLATES: Record<
  TriggeredKey,
  { name: string; subject: string; htmlBody: string }
> = {
  "order.confirmation": {
    name: "Order confirmation",
    subject: "Order {{orderNumber}} confirmed",
    htmlBody:
      "<p>Hi {{customerName}},</p><p>Your order <strong>#{{orderNumber}}</strong> is confirmed.</p><p>Total: {{total}}</p>",
  },
  "order.payment_link": {
    name: "Payment link",
    subject: "Complete payment for order {{orderNumber}}",
    htmlBody:
      "<p>Hi {{customerName}},</p><p>Please pay order <strong>#{{orderNumber}}</strong>.</p><p><a href=\"{{paymentUrl}}\">Pay now</a></p>",
  },
  "order.refund": {
    name: "Refund notice",
    subject: "Refund for order {{orderNumber}}",
    htmlBody:
      "<p>Hi {{customerName}},</p><p>We issued a refund of {{refundAmount}} on order <strong>#{{orderNumber}}</strong>.</p>",
  },
};

export const BRANDING_DEFAULT = {
  primaryColor: "#1f4d3a",
  footerText: "Tomchei Shabbos · Brooklyn",
  logoUrl: "",
} as const;

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}
