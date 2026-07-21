import { NotifyChannel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/stripe/client";
import { enqueueNotification } from "@/lib/notify/outbox";
import {
  DEFAULT_TEMPLATES,
  TRIGGERED_KEYS,
  type TriggeredKey,
  renderTemplate,
  sanitizeSameOriginUrl,
} from "@/lib/email/templates";
import { err, ok, type Result } from "@/lib/result";

export async function ensureSystemTemplates() {
  for (const key of TRIGGERED_KEYS) {
    const def = DEFAULT_TEMPLATES[key];
    await db.emailTemplate.upsert({
      where: { key },
      create: {
        key,
        name: def.name,
        subject: def.subject,
        htmlBody: def.htmlBody,
        isSystem: true,
        branding: { footerText: "Tomchei Shabbos · Brooklyn" },
      },
      update: {},
    });
  }
}

export async function listTemplates() {
  await ensureSystemTemplates();
  return db.emailTemplate.findMany({ orderBy: { key: "asc" } });
}

export async function upsertTemplate(input: {
  key: string;
  name: string;
  subject: string;
  htmlBody: string;
  branding?: Prisma.InputJsonValue;
}) {
  return db.emailTemplate.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      name: input.name,
      subject: input.subject,
      htmlBody: input.htmlBody,
      branding: input.branding ?? Prisma.JsonNull,
      isSystem: TRIGGERED_KEYS.includes(input.key as TriggeredKey),
    },
    update: {
      name: input.name,
      subject: input.subject,
      htmlBody: input.htmlBody,
      branding: input.branding ?? undefined,
    },
  });
}

export async function listTriggeredOverrides() {
  await ensureSystemTemplates();
  const overrides = await db.triggeredEmailOverride.findMany();
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  return TRIGGERED_KEYS.map((key) => ({
    key,
    defaults: DEFAULT_TEMPLATES[key],
    override: byKey.get(key) ?? null,
  }));
}

export async function setTriggeredOverride(input: {
  key: TriggeredKey;
  subject?: string | null;
  htmlBody?: string | null;
  enabled?: boolean;
}) {
  if (!TRIGGERED_KEYS.includes(input.key)) {
    return err("bad_key", "Unknown triggered email key.");
  }
  const row = await db.triggeredEmailOverride.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      subject: input.subject ?? null,
      htmlBody: input.htmlBody ?? null,
      enabled: input.enabled ?? true,
    },
    update: {
      subject: input.subject === undefined ? undefined : input.subject,
      htmlBody: input.htmlBody === undefined ? undefined : input.htmlBody,
      enabled: input.enabled,
    },
  });
  return ok(row);
}

export async function resolveTriggeredContent(
  key: TriggeredKey,
  vars: Record<string, string>,
): Promise<Result<{ subject: string; htmlBody: string; enabled: boolean }>> {
  await ensureSystemTemplates();
  const template = await db.emailTemplate.findUnique({ where: { key } });
  const override = await db.triggeredEmailOverride.findUnique({ where: { key } });
  if (override && !override.enabled) {
    return err("disabled", "This triggered email is disabled.");
  }
  const subjectTpl = override?.subject || template?.subject || DEFAULT_TEMPLATES[key].subject;
  const bodyTpl = override?.htmlBody || template?.htmlBody || DEFAULT_TEMPLATES[key].htmlBody;
  return ok({
    subject: renderTemplate(subjectTpl, vars),
    htmlBody: renderTemplate(bodyTpl, vars),
    enabled: true,
  });
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Domain-event enqueue for order lifecycle emails (R-087). */
export async function enqueueOrderEmail(input: {
  key: TriggeredKey;
  orderId: string;
  recipientEmail: string;
  vars: Record<string, string>;
  actorId?: string | null;
  forceCapture?: boolean;
}) {
  const content = await resolveTriggeredContent(input.key, input.vars);
  if (!content.ok) return content;

  const recipientKey = input.recipientEmail.trim().toLowerCase();
  const idempotencyKey = `${input.key}:${input.orderId}:${recipientKey}`;
  const enqueueResult = await enqueueNotification({
    channel: NotifyChannel.EMAIL,
    templateKey: input.key,
    recipientKey,
    idempotencyKey,
    subject: content.value.subject,
    body: content.value.htmlBody,
    meta: { orderId: input.orderId, triggeredKey: input.key },
    actorId: input.actorId,
    forceCapture: input.forceCapture,
  });
  return ok({
    created: enqueueResult.created,
    outboxId: enqueueResult.row.id,
    status: enqueueResult.row.status,
    idempotencyKey,
  });
}

export async function enqueueOrderConfirmation(order: {
  id: string;
  orderNumber: number | null;
  expectedTotalCents: number | null;
  customer?: { email: string | null; displayName: string } | null;
  recipientEmail?: string | null;
}) {
  const email = order.recipientEmail || order.customer?.email || null;
  if (!email) return err("no_email", "Order has no recipient email.");
  return enqueueOrderEmail({
    key: "order.confirmation",
    orderId: order.id,
    recipientEmail: email,
    vars: {
      orderNumber: String(order.orderNumber ?? "—"),
      customerName: order.customer?.displayName ?? "there",
      total: money(order.expectedTotalCents ?? 0),
    },
  });
}

export async function enqueuePaymentLinkEmail(order: {
  id: string;
  orderNumber: number | null;
  paymentUrl: string;
  customer?: { email: string | null; displayName: string } | null;
  recipientEmail?: string | null;
}) {
  const email = order.recipientEmail || order.customer?.email || null;
  if (!email) return err("no_email", "Order has no recipient email.");
  const paymentUrl =
    sanitizeSameOriginUrl(order.paymentUrl, appUrl()) || `${appUrl()}/checkout`;
  return enqueueOrderEmail({
    key: "order.payment_link",
    orderId: order.id,
    recipientEmail: email,
    vars: {
      orderNumber: String(order.orderNumber ?? "—"),
      customerName: order.customer?.displayName ?? "there",
      paymentUrl,
    },
  });
}

export async function enqueueRefundEmail(order: {
  id: string;
  orderNumber: number | null;
  refundCents: number;
  customer?: { email: string | null; displayName: string } | null;
  recipientEmail?: string | null;
}) {
  const email = order.recipientEmail || order.customer?.email || null;
  if (!email) return err("no_email", "Order has no recipient email.");
  return enqueueOrderEmail({
    key: "order.refund",
    orderId: order.id,
    recipientEmail: email,
    vars: {
      orderNumber: String(order.orderNumber ?? "—"),
      customerName: order.customer?.displayName ?? "there",
      refundAmount: money(order.refundCents),
    },
  });
}
