import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { DomainRuleError } from "@/lib/errors";
import { mapDomainError } from "@/lib/http-errors";
import { getCampaignOrThrow } from "@/lib/email/campaigns";
import { getEmailListOrThrow } from "@/lib/email/lists";

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
  const gate = await requireApiPermission("email.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  try {
    const campaign = await getCampaignOrThrow(id);
    const recipients = await prisma.emailCampaignRecipient.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ ok: true, campaign: { ...campaign, recipients } });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("email.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, patchSchema, "At least one field to update is required");
  if (!parsed.ok) return parsed.response;

  try {
    const campaign = await getCampaignOrThrow(id);
    if (campaign.status !== "DRAFT") {
      throw new DomainRuleError(`Campaign ${campaign.name} is ${campaign.status}; expected DRAFT to edit`);
    }
    if (parsed.data.listId) {
      await getEmailListOrThrow(parsed.data.listId);
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
