import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enqueueTransactionalEmail,
  queueCampaign,
  queueCampaignTest,
} from "@/domain/messaging";
import { loadEmailHubState } from "@/domain/messaging-hub";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";

const createCampaignSchema = z.object({
  action: z.literal("createCampaign"),
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(2).max(200),
  htmlBody: z.string().trim().min(2).max(50_000),
  textBody: z.string().trim().min(2).max(20_000),
  emailListId: z.string().min(1),
});

const campaignActionSchema = z.object({
  action: z.enum(["testCampaign", "sendCampaign"]),
  campaignId: z.string().min(1),
  recipient: z.string().email().optional(),
});

const testTransactionalSchema = z.object({
  action: z.literal("testTransactional"),
  recipient: z.string().email(),
  templateKey: z.string().min(1),
});

function apiError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  throw error;
}

export async function GET() {
  try {
    await requirePermission("settings:manage");
    return NextResponse.json(await loadEmailHubState(db));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const body = await request.json().catch(() => null);
    const createCampaign = createCampaignSchema.safeParse(body);
    if (createCampaign.success) {
      const campaign = await db.emailCampaign.create({
        data: {
          name: createCampaign.data.name,
          subject: createCampaign.data.subject,
          htmlBody: createCampaign.data.htmlBody,
          textBody: createCampaign.data.textBody,
          emailListId: createCampaign.data.emailListId,
          createdById: staffSession.actor.id,
        },
      });
      return NextResponse.json(campaign, { status: 201 });
    }

    const campaignAction = campaignActionSchema.safeParse(body);
    if (campaignAction.success) {
      if (campaignAction.data.action === "testCampaign") {
        if (!campaignAction.data.recipient) {
          return NextResponse.json(
            { error: "A test recipient is required." },
            { status: 400 },
          );
        }
        await queueCampaignTest(
          db,
          campaignAction.data.campaignId,
          normalizeEmail(campaignAction.data.recipient),
        );
        return NextResponse.json({ queued: 1 });
      }
      return NextResponse.json({
        queued: await queueCampaign(db, campaignAction.data.campaignId),
      });
    }

    const transactionalTest = testTransactionalSchema.safeParse(body);
    if (transactionalTest.success) {
      await enqueueTransactionalEmail(db, {
        idempotencyKey: `settings-test:${transactionalTest.data.templateKey}:${Date.now()}`,
        templateKey: transactionalTest.data.templateKey,
        recipient: normalizeEmail(transactionalTest.data.recipient),
        variables: {
          customerName: "Test Customer",
          orderNumber: "TEST-1001",
          paymentUrl: "https://example.test/pay",
          refundAmount: "$18.00",
          recipientName: "Test Recipient",
          pickupLocation: "Main office",
          deliveryWindow: "10:00 AM–12:00 PM",
        },
      });
      return NextResponse.json({ queued: 1 });
    }

    return NextResponse.json(
      { error: "Email hub request is invalid." },
      { status: 400 },
    );
  } catch (error) {
    return apiError(error);
  }
}

const templateSchema = z.object({
  key: z.string().min(1),
  subject: z.string().trim().min(2).max(200),
  htmlBody: z.string().trim().min(2).max(50_000),
  textBody: z.string().trim().min(2).max(20_000),
  isEnabled: z.boolean(),
});

export async function PATCH(request: Request) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const parsed = templateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Template fields are invalid." }, { status: 400 });
    }
    const template = await db.emailTemplate.update({
      where: { key: parsed.data.key },
      data: {
        subject: parsed.data.subject,
        htmlBody: parsed.data.htmlBody,
        textBody: parsed.data.textBody,
        isEnabled: parsed.data.isEnabled,
      },
    });
    await db.auditLog.create({
      data: {
        actorStaffId: staffSession.actor.id,
        action: "email.template_updated",
        targetType: "EmailTemplate",
        targetId: template.id,
        metadata: { key: template.key, isEnabled: template.isEnabled },
      },
    });
    return NextResponse.json(template);
  } catch (error) {
    return apiError(error);
  }
}
