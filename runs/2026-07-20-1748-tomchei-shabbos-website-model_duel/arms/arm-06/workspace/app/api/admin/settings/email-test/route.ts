import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { currentDeliveryMode, deliverMessage } from "@/lib/email/dispatch";
import { brandTokens, getEmailBranding, renderTemplate } from "@/lib/email/render";

export const dynamic = "force-dynamic";

const testSchema = z.object({ toAddress: z.string().email() });

// R-090: the settings email test sender. The test email is a real outbox row
// (kind test_email) put through one immediate dispatch attempt — the same
// path the sweeper takes — so the answer proves configuration end-to-end:
// live key → provider id, fixture → fixture id, no key → capture id, provider
// failure → FAILED with the error visible.
export async function POST(request: Request) {
  const gate = await requireApiPermission("settings.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, testSchema, "An email address is required");
  if (!parsed.ok) return parsed.response;

  const branding = await getEmailBranding();
  const tokens = brandTokens(branding, { customerName: "Test Recipient" });
  const row = await prisma.outboxMessage.create({
    data: {
      kind: "test_email",
      channel: "EMAIL",
      toAddress: parsed.data.toAddress,
      subject: renderTemplate("{{brand}} test email", tokens),
      body: renderTemplate(
        "Hello {{customerName}},\n\nThis is a test email from the {{brand}} settings hub. If you can read this, outbound email is working.\n\n{{footer}}",
        tokens,
      ),
    },
  });

  let delivered = true;
  let lastError: string | null = null;
  try {
    const outcome = await deliverMessage(row);
    await prisma.outboxMessage.update({
      where: { id: row.id },
      data: { status: "SENT", attempts: 1, lastAttemptAt: new Date(), providerId: outcome.providerId, sentAt: new Date() },
    });
  } catch (error) {
    delivered = false;
    lastError = error instanceof Error ? error.message : String(error);
    await prisma.outboxMessage.update({
      where: { id: row.id },
      data: { status: "FAILED", attempts: 1, lastAttemptAt: new Date(), lastError },
    });
  }

  const updated = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: row.id } });
  await recordAudit({
    ctx: gate.ctx,
    action: "email_test_send",
    targetType: "OutboxMessage",
    targetId: row.id,
    metadata: { toAddress: parsed.data.toAddress, delivered, mode: currentDeliveryMode() },
  });

  return NextResponse.json({
    ok: true,
    delivered,
    mode: currentDeliveryMode(),
    providerId: updated.providerId,
    error: lastError,
  });
}
