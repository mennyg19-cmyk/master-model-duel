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

/** Escape untrusted values before substituting into HTML email bodies. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Allow only http(s) URLs on the app origin (blocks javascript: and off-site phishing links).
 * Returns empty string when the candidate is unsafe.
 */
export function sanitizeSameOriginUrl(raw: string, appOriginBase: string): string {
  try {
    const allowed = new URL(appOriginBase).origin;
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.origin !== allowed) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    escapeHtml(vars[key] ?? ""),
  );
}
