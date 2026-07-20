import { EmailHub } from "@/components/email-hub";
import { ensureMessagingConfiguration } from "@/domain/messaging";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminEmailPage() {
  await requirePermission("settings:manage");
  await ensureMessagingConfiguration(db);
  const [lists, templates, campaigns, messages] = await Promise.all([
    db.emailList.findMany({ orderBy: { name: "asc" } }),
    db.emailTemplate.findMany({ orderBy: { name: "asc" } }),
    db.emailCampaign.findMany({
      include: { emailList: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.messageOutbox.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        eventKey: true,
        recipient: true,
        channel: true,
        status: true,
        attempts: true,
        lastError: true,
      },
    }),
  ]);
  return (
    <EmailHub
      initialCampaigns={campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        status: campaign.status,
        emailList: { name: campaign.emailList.name },
        sentAt: campaign.sentAt?.toISOString() ?? null,
      }))}
      initialMessages={messages}
      initialTemplates={templates.map((template) => ({
        key: template.key,
        name: template.name,
        subject: template.subject,
        htmlBody: template.htmlBody,
        textBody: template.textBody,
        isEnabled: template.isEnabled,
      }))}
      lists={lists}
    />
  );
}
