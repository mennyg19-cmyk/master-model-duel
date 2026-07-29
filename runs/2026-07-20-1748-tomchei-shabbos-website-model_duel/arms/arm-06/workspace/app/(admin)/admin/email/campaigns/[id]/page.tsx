import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { renderCampaignPreview } from "@/lib/email/campaigns";
import { brandTokens, getEmailBranding } from "@/lib/email/render";
import { BackLink } from "@/components/admin/back-link";
import { CampaignEditor } from "@/components/admin/email/campaign-editor";

export const metadata: Metadata = { title: "Campaign" };
export const dynamic = "force-dynamic";

// R-083: the campaign builder — draft edit, branding-accurate preview,
// test-send, send/rerun with the idempotency report, and the recipient rows.
export default async function AdminCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("email.manage");
  const { id } = await params;

  const campaign = await prisma.emailCampaign.findUnique({
    where: { id },
    include: {
      list: { select: { id: true, name: true } },
      recipients: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!campaign) notFound();

  const lists = await prisma.emailList.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const branding = await getEmailBranding();
  const preview = renderCampaignPreview(campaign, brandTokens(branding, { customerName: "Malka Stein" }));

  return (
    <div>
      <BackLink href="/admin/email" label="Back to email platform" />
      <h1 className="mt-2 text-2xl font-semibold">{campaign.name}</h1>
      <CampaignEditor
        campaign={{
          id: campaign.id,
          name: campaign.name,
          subject: campaign.subject,
          bodyText: campaign.bodyText,
          listId: campaign.listId,
          listName: campaign.list.name,
          status: campaign.status,
          sentAt: campaign.sentAt?.toISOString() ?? null,
          lastError: campaign.lastError,
        }}
        lists={lists}
        preview={preview}
        recipients={campaign.recipients.map((recipient) => ({
          id: recipient.id,
          email: recipient.email,
          status: recipient.status,
          attempts: recipient.attempts,
          providerId: recipient.providerId,
          lastError: recipient.lastError,
          sentAt: recipient.sentAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
