import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
});

// R-084: mailing lists over newsletter subscribers.
export async function GET() {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const lists = await prisma.emailList.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { members: true } },
      members: { include: { subscriber: { select: { id: true, email: true, name: true, unsubscribedAt: true } } } },
    },
  });
  return NextResponse.json({ ok: true, lists });
}

export async function POST(request: Request) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, createSchema, "A list name is required");
  if (!parsed.ok) return parsed.response;

  const existing = await prisma.emailList.findUnique({ where: { name: parsed.data.name } });
  if (existing) return NextResponse.json({ error: `A list named ${parsed.data.name} already exists` }, { status: 409 });

  const list = await prisma.emailList.create({ data: parsed.data });
  await recordAudit({
    ctx: gate.ctx,
    action: "email_hub_update",
    targetType: "EmailList",
    targetId: list.id,
    metadata: { kind: "list_create", name: list.name },
  });
  return NextResponse.json({ ok: true, list }, { status: 201 });
}
