import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";

export const dynamic = "force-dynamic";

const memberSchema = z.object({ subscriberId: z.string().min(1) });

// R-084: list membership management. Adds are idempotent on the unique
// [listId, subscriberId] pair; removes are scoped deletes.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, memberSchema, "A subscriberId is required");
  if (!parsed.ok) return parsed.response;

  const [list, subscriber] = await Promise.all([
    prisma.emailList.findUnique({ where: { id } }),
    prisma.newsletterSubscriber.findUnique({ where: { id: parsed.data.subscriberId } }),
  ]);
  if (!list) return NextResponse.json({ error: "EmailList not found" }, { status: 404 });
  if (!subscriber) return NextResponse.json({ error: "NewsletterSubscriber not found" }, { status: 404 });

  await prisma.emailListMembership.upsert({
    where: { listId_subscriberId: { listId: id, subscriberId: subscriber.id } },
    update: {},
    create: { listId: id, subscriberId: subscriber.id },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "email_hub_update",
    targetType: "EmailList",
    targetId: id,
    metadata: { kind: "list_member_add", subscriberId: subscriber.id, email: subscriber.email },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, memberSchema, "A subscriberId is required");
  if (!parsed.ok) return parsed.response;

  const removed = await prisma.emailListMembership.deleteMany({
    where: { listId: id, subscriberId: parsed.data.subscriberId },
  });
  if (removed.count > 0) {
    await recordAudit({
      ctx: gate.ctx,
      action: "email_hub_update",
      targetType: "EmailList",
      targetId: id,
      metadata: { kind: "list_member_remove", subscriberId: parsed.data.subscriberId },
    });
  }
  return NextResponse.json({ ok: true, removed: removed.count });
}
