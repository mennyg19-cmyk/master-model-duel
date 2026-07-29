import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { DomainRuleError } from "@/lib/errors";
import { mapDomainError } from "@/lib/http-errors";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(500).optional(),
  bodyText: z.string().min(1).optional(),
  listId: z.string().min(1).optional(),
});

// R-083: campaign detail + draft edit. Only DRAFT campaigns edit — once a
// send has snapshotted recipients, the mailed bytes are history.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const campaign = await prisma.emailCampaign.findUnique({
    where: { id },
    include: {
      list: { select: { id: true, name: true } },
      recipients: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!campaign) return NextResponse.json({ error: "EmailCampaign not found" }, { status: 404 });
  return NextResponse.json({ ok: true, campaign });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, patchSchema, "At least one field to update is required");
  if (!parsed.ok) return parsed.response;

  try {
    const campaign = await prisma.emailCampaign.findUnique({ where: { id } });
    if (!campaign) return NextResponse.json({ error: "EmailCampaign not found" }, { status: 404 });
    if (campaign.status !== "DRAFT") {
      throw new DomainRuleError(`Campaign ${campaign.name} is ${campaign.status}; expected DRAFT to edit`);
    }
    if (parsed.data.listId) {
      const list = await prisma.emailList.findUnique({ where: { id: parsed.data.listId } });
      if (!list) return NextResponse.json({ error: "EmailList not found" }, { status: 404 });
    }
    const updated = await prisma.emailCampaign.update({ where: { id }, data: parsed.data });
    await recordAudit({
      ctx: gate.ctx,
      action: "email_hub_update",
      targetType: "EmailCampaign",
      targetId: id,
      metadata: { kind: "campaign_edit", name: updated.name },
    });
    return NextResponse.json({ ok: true, campaign: updated });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
