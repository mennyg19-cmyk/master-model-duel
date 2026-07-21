import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { createNewsletterToken } from "@/lib/newsletter-token";
import { sendCampaign } from "@/lib/email/campaigns";

/**
 * Queue the campaign to its audience (R-083). Idempotent rerun: addresses
 * already queued collide on the outbox dedupeKey and are skipped, so a retry
 * or double click can never deliver twice (S2).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const result = await sendCampaign(id, (email) => createNewsletterToken(email));
  if ("error" in result) return Response.json({ error: result.error }, { status: 409 });

  await writeAudit(gate.staff, {
    action: "email.campaign.send",
    targetType: "Campaign",
    targetId: id,
    detail: result,
  });
  return Response.json({ ok: true, ...result });
}
