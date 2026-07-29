import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TRIGGERED_DEFAULTS, TRIGGERED_KEYS } from "@/lib/email/triggered";
import { currentDeliveryMode } from "@/lib/email/dispatch";
import { EmailTabs } from "@/components/admin/email/email-tabs";
import { RECENT_OUTBOX_LIMIT } from "@/components/admin/email/hub-display";

export const metadata: Metadata = { title: "Email" };
export const dynamic = "force-dynamic";

// R-082: the email hub — campaigns, subscribers, lists, templates, triggered.
export default async function AdminEmailPage() {
  await requirePermission("email.manage");

  const [campaigns, subscribers, lists, templates, overrides, recentOutbox] = await Promise.all([
    prisma.emailCampaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { list: { select: { id: true, name: true } }, _count: { select: { recipients: true } } },
    }),
    prisma.newsletterSubscriber.findMany({
      orderBy: { createdAt: "desc" },
      include: { listMemberships: { select: { listId: true } } },
    }),
    prisma.emailList.findMany({
      orderBy: { name: "asc" },
      include: {
        members: { include: { subscriber: { select: { id: true, email: true, name: true, unsubscribedAt: true } } } },
      },
    }),
    prisma.emailTemplate.findMany({ orderBy: { key: "asc" } }),
    prisma.emailTriggeredOverride.findMany(),
    prisma.outboxMessage.findMany({ orderBy: { createdAt: "desc" }, take: RECENT_OUTBOX_LIMIT }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Email platform</h1>
      <EmailTabs
        mode={currentDeliveryMode()}
        campaigns={campaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          subject: campaign.subject,
          status: campaign.status,
          listName: campaign.list.name,
          recipientCount: campaign._count.recipients,
          sentAt: campaign.sentAt?.toISOString() ?? null,
          lastError: campaign.lastError,
          createdAt: campaign.createdAt.toISOString(),
        }))}
        lists={lists.map((list) => ({
          id: list.id,
          name: list.name,
          description: list.description,
          members: list.members.map((member) => ({
            subscriberId: member.subscriberId,
            email: member.subscriber.email,
            name: member.subscriber.name,
            unsubscribed: member.subscriber.unsubscribedAt !== null,
          })),
        }))}
        subscribers={subscribers.map((subscriber) => ({
          id: subscriber.id,
          email: subscriber.email,
          name: subscriber.name,
          prefNewProducts: subscriber.prefNewProducts,
          prefReminders: subscriber.prefReminders,
          prefCommunity: subscriber.prefCommunity,
          unsubscribed: subscriber.unsubscribedAt !== null,
          listIds: subscriber.listMemberships.map((membership) => membership.listId),
        }))}
        templates={templates.map((template) => ({
          id: template.id,
          key: template.key,
          name: template.name,
          subject: template.subject,
          bodyText: template.bodyText,
        }))}
        triggered={TRIGGERED_KEYS.map((key) => {
          const override = overrides.find((entry) => entry.key === key);
          return {
            key,
            name: TRIGGERED_DEFAULTS[key].name,
            defaultSubject: TRIGGERED_DEFAULTS[key].subject,
            enabled: override?.enabled ?? true,
            subjectOverride: override?.subjectOverride ?? null,
            bodyTemplateOverride: override?.bodyTemplateOverride ?? null,
            templateId: override?.templateId ?? null,
          };
        })}
        recentOutbox={recentOutbox.map((message) => ({
          id: message.id,
          kind: message.kind,
          channel: message.channel,
          toAddress: message.toAddress,
          subject: message.subject,
          status: message.status,
          attempts: message.attempts,
          providerId: message.providerId,
          lastError: message.lastError,
          createdAt: message.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
