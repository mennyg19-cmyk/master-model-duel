import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import {
  addListMembers,
  createCampaign,
  createMailingList,
  listCampaigns,
  listMailingLists,
  previewCampaign,
  sendCampaign,
  testSendCampaign,
} from "@/lib/email/campaigns";
import {
  listTemplates,
  listTriggeredOverrides,
  setTriggeredOverride,
  upsertTemplate,
  enqueueOrderEmail,
} from "@/lib/email/order-emails";
import { TRIGGERED_KEYS, type TriggeredKey, sanitizeSameOriginUrl } from "@/lib/email/templates";
import { db } from "@/lib/db";
import { sendTestEmail } from "@/lib/email/purge";
import { EMAIL_SETTINGS } from "@/lib/resend/client";
import { setSetting, getSetting } from "@/lib/settings";
import { appUrl } from "@/lib/stripe/client";

export async function GET(request: Request) {
  try {
    await requirePermission("settings.read");
    const url = new URL(request.url);
    const tab = url.searchParams.get("tab") || "campaigns";

    if (tab === "campaigns") {
      return NextResponse.json({ ok: true, campaigns: await listCampaigns() });
    }
    if (tab === "subscribers") {
      const subscribers = await db.newsletterSubscriber.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return NextResponse.json({ ok: true, subscribers });
    }
    if (tab === "lists") {
      return NextResponse.json({ ok: true, lists: await listMailingLists() });
    }
    if (tab === "templates") {
      return NextResponse.json({ ok: true, templates: await listTemplates() });
    }
    if (tab === "triggered") {
      return NextResponse.json({ ok: true, triggered: await listTriggeredOverrides() });
    }
    return NextResponse.json({ error: "Unknown tab" }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_campaign"),
    name: z.string().min(1),
    subject: z.string().min(1),
    htmlBody: z.string().min(1),
    listId: z.string().optional().nullable(),
  }),
  z.object({
    action: z.literal("preview_campaign"),
    campaignId: z.string().min(1),
  }),
  z.object({
    action: z.literal("test_send_campaign"),
    campaignId: z.string().min(1),
    to: z.string().email(),
  }),
  z.object({
    action: z.literal("send_campaign"),
    campaignId: z.string().min(1),
  }),
  z.object({
    action: z.literal("create_list"),
    name: z.string().min(1),
    description: z.string().optional(),
    subscriberIds: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("add_list_members"),
    listId: z.string().min(1),
    subscriberIds: z.array(z.string()).min(1),
  }),
  z.object({
    action: z.literal("upsert_template"),
    key: z.string().min(1),
    name: z.string().min(1),
    subject: z.string().min(1),
    htmlBody: z.string().min(1),
    branding: z.unknown().optional(),
  }),
  z.object({
    action: z.literal("set_triggered"),
    key: z.enum(TRIGGERED_KEYS as unknown as [TriggeredKey, ...TriggeredKey[]]),
    subject: z.string().nullable().optional(),
    htmlBody: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("trigger_transactional"),
    key: z.enum(TRIGGERED_KEYS as unknown as [TriggeredKey, ...TriggeredKey[]]),
    orderId: z.string().min(1),
    recipientEmail: z.string().email(),
    vars: z.record(z.string()).optional(),
  }),
  z.object({
    action: z.literal("test_email"),
    to: z.string().email(),
    subject: z.string().optional(),
    body: z.string().optional(),
  }),
  z.object({
    action: z.literal("set_force_fail"),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("get_force_fail"),
  }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = postSchema.parse(await request.json());

    switch (body.action) {
      case "create_campaign": {
        const campaign = await createCampaign({
          ...body,
          createdById: ctx.effectiveStaff.id,
        });
        return NextResponse.json({ ok: true, campaign });
      }
      case "preview_campaign": {
        const preview = await previewCampaign(body.campaignId);
        if (!preview.ok) {
          return NextResponse.json({ error: preview.publicMessage }, { status: 404 });
        }
        return NextResponse.json({ ok: true, preview: preview.value });
      }
      case "test_send_campaign": {
        const result = await testSendCampaign({
          campaignId: body.campaignId,
          to: body.to,
          actorId: ctx.effectiveStaff.id,
        });
        if (!result.ok) {
          return NextResponse.json({ error: result.publicMessage }, { status: 400 });
        }
        return NextResponse.json({ ok: true, ...result.value });
      }
      case "send_campaign": {
        const result = await sendCampaign({
          campaignId: body.campaignId,
          actorId: ctx.effectiveStaff.id,
        });
        if (!result.ok) {
          return NextResponse.json({ error: result.publicMessage }, { status: 400 });
        }
        return NextResponse.json({ ok: true, ...result.value });
      }
      case "create_list": {
        const list = await createMailingList(body);
        return NextResponse.json({ ok: true, list });
      }
      case "add_list_members": {
        const result = await addListMembers(body.listId, body.subscriberIds);
        return NextResponse.json({ ok: true, ...result });
      }
      case "upsert_template": {
        const template = await upsertTemplate({
          key: body.key,
          name: body.name,
          subject: body.subject,
          htmlBody: body.htmlBody,
          branding: body.branding as never,
        });
        return NextResponse.json({ ok: true, template });
      }
      case "set_triggered": {
        const result = await setTriggeredOverride(body);
        if (!result.ok) {
          return NextResponse.json({ error: result.publicMessage }, { status: 400 });
        }
        return NextResponse.json({ ok: true, override: result.value });
      }
      case "trigger_transactional": {
        const order = await db.order.findUnique({
          where: { id: body.orderId },
          include: {
            customer: { select: { displayName: true, email: true } },
          },
        });
        const base = appUrl();
        const requestedPaymentUrl = body.vars?.paymentUrl;
        const paymentUrl =
          (requestedPaymentUrl
            ? sanitizeSameOriginUrl(requestedPaymentUrl, base)
            : "") || `${base}/checkout`;
        const enqueueResult = await enqueueOrderEmail({
          key: body.key,
          orderId: body.orderId,
          recipientEmail: body.recipientEmail,
          vars: {
            orderNumber:
              body.vars?.orderNumber ??
              (order?.orderNumber != null ? String(order.orderNumber) : "—"),
            customerName:
              body.vars?.customerName ?? order?.customer?.displayName ?? "Friend",
            total:
              body.vars?.total ??
              (order?.expectedTotalCents != null
                ? `$${(order.expectedTotalCents / 100).toFixed(2)}`
                : "$0.00"),
            paymentUrl,
            refundAmount: body.vars?.refundAmount ?? "$0.00",
          },
          actorId: ctx.effectiveStaff.id,
        });
        if (!enqueueResult.ok) {
          return NextResponse.json({ error: enqueueResult.publicMessage }, { status: 400 });
        }
        return NextResponse.json({ ok: true, ...enqueueResult.value });
      }
      case "test_email": {
        const result = await sendTestEmail({
          to: body.to,
          subject: body.subject,
          body: body.body,
          actorId: ctx.effectiveStaff.id,
        });
        if (!result.ok) {
          return NextResponse.json({ error: result.publicMessage }, { status: 400 });
        }
        return NextResponse.json({ ok: true, ...result.value });
      }
      case "set_force_fail": {
        await setSetting(EMAIL_SETTINGS.forceFail, { enabled: body.enabled });
        return NextResponse.json({ ok: true, enabled: body.enabled });
      }
      case "get_force_fail": {
        const setting = await getSetting<{ enabled?: boolean }>(EMAIL_SETTINGS.forceFail);
        return NextResponse.json({ ok: true, enabled: Boolean(setting?.enabled) });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
