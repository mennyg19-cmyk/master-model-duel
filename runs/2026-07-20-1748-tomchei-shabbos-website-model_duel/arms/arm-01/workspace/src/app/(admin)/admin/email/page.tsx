import { EmailHub } from "@/components/email-hub";
import { loadEmailHubState } from "@/domain/messaging-hub";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminEmailPage() {
  await requirePermission("settings:manage");
  const { lists, templates, campaigns, recentMessages } =
    await loadEmailHubState(db);
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
      initialMessages={recentMessages}
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
