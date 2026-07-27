import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addSubscriberToEmailList,
  createCampaign,
  createEmailList,
  emailHub,
  sendCampaign,
  sendTestEmail,
  sweepEmailOutbox,
  testSendCampaign,
  updateEmailTemplate,
} from "@/lib/email";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_campaign"), name: z.string().trim().min(1).max(120), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000), listId: z.string().cuid().optional() }),
  z.object({ action: z.literal("send_campaign"), campaignId: z.string().cuid() }),
  z.object({ action: z.literal("test_campaign"), campaignId: z.string().cuid(), recipient: z.string().email().max(254) }),
  z.object({ action: z.literal("create_list"), name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("add_list_member"), listId: z.string().cuid(), subscriberId: z.string().cuid() }),
  z.object({ action: z.literal("test_email"), recipient: z.string().email().max(254) }),
  z.object({
    action: z.literal("update_template"),
    key: z.enum(["ORDER_CONFIRMATION", "PAYMENT_LINK", "REFUND"]),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20_000),
    branding: z.record(z.string(), z.string()).default({}),
  }),
  z.object({ action: z.literal("sweep") }),
]);

export async function GET(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  return NextResponse.json(await emailHub());
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid email operation." }, { status: 400 });
  try {
    if (parsed.data.action === "create_campaign") {
      return NextResponse.json({ campaign: await createCampaign(parsed.data) });
    }
    if (parsed.data.action === "send_campaign") {
      return NextResponse.json(await sendCampaign(parsed.data.campaignId));
    }
    if (parsed.data.action === "test_campaign") {
      await testSendCampaign(parsed.data.campaignId, parsed.data.recipient);
      return NextResponse.json({ message: "Campaign test email queued." }, { status: 202 });
    }
    if (parsed.data.action === "create_list") {
      return NextResponse.json({ list: await createEmailList(parsed.data.name) });
    }
    if (parsed.data.action === "add_list_member") {
      return NextResponse.json({ member: await addSubscriberToEmailList(parsed.data.listId, parsed.data.subscriberId) });
    }
    if (parsed.data.action === "test_email") {
      await sendTestEmail(parsed.data.recipient);
      return NextResponse.json({ message: "Platform test email queued." }, { status: 202 });
    }
    if (parsed.data.action === "update_template") {
      return NextResponse.json({ template: await updateEmailTemplate(parsed.data) });
    }
    return NextResponse.json(await sweepEmailOutbox());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Email operation could not be completed." }, { status: 400 });
  }
}
