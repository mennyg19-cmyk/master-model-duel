import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { getEmailListOrThrow } from "@/lib/email/lists";
import { mapDomainError } from "@/lib/http-errors";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  bodyText: z.string().min(1),
  listId: z.string().min(1),
});

// R-083/R-089: campaign list + create. New campaigns are DRAFT; sending is a
// separate explicit action (POST .../send) so a form slip can never mail.
export async function GET() {
  const gate = await requireApiPermission("email.manage");
  if (!gate.ok) return gate.response;

  const campaigns = await prisma.emailCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      list: { select: { id: true, name: true } },
      _count: { select: { recipients: true } },
    },
  });
  return NextResponse.json({ ok: true, campaigns });
}

export async function POST(request: Request) {
  const gate = await requireApiPermission("email.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, createSchema, "name, subject, bodyText, and listId are required");
  if (!parsed.ok) return parsed.response;

  try {
    const list = await getEmailListOrThrow(parsed.data.listId);
    const campaign = await prisma.emailCampaign.create({
      data: { ...parsed.data, createdById: gate.ctx.staff.id },
    });
    await recordAudit({
      ctx: gate.ctx,
      action: "email_hub_update",
      targetType: "EmailCampaign",
      targetId: campaign.id,
      metadata: { kind: "campaign_create", name: campaign.name, listId: list.id },
    });
    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
