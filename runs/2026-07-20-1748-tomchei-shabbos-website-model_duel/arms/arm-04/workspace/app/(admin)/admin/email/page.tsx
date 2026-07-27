import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { TEMPLATE_DEFAULTS, TEMPLATE_KEYS, resolveTemplate } from "@/lib/email/templates";
import { EmailHub, type EmailHubData } from "@/components/admin/email-hub";

export default async function EmailHubPage() {
  await requirePermissionPage("email.manage");

  const [campaigns, lists, subscriberCounts, overrides, outboxCounts] = await Promise.all([
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { list: { select: { name: true } } } }),
    db.emailList.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } }),
    Promise.all([
      db.newsletterSubscriber.count({ where: { status: "SUBSCRIBED" } }),
      db.newsletterSubscriber.count({ where: { status: "UNSUBSCRIBED" } }),
    ]),
    Promise.all(TEMPLATE_KEYS.map((key) => resolveTemplate(key))),
    db.notification.groupBy({ by: ["status"], _count: true }),
  ]);

  const data: EmailHubData = {
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      body: campaign.body,
      listId: campaign.listId,
      listName: campaign.list?.name ?? null,
      status: campaign.status,
      queuedCount: campaign.queuedCount,
      sentAt: campaign.sentAt?.toISOString() ?? null,
    })),
    lists: lists.map((list) => ({ id: list.id, name: list.name, memberCount: list._count.members })),
    subscribedCount: subscriberCounts[0],
    unsubscribedCount: subscriberCounts[1],
    templates: TEMPLATE_KEYS.map((key, index) => ({
      key,
      label: TEMPLATE_DEFAULTS[key].label,
      placeholders: [...TEMPLATE_DEFAULTS[key].placeholders],
      subject: overrides[index].subject,
      body: overrides[index].body,
      isEnabled: overrides[index].isEnabled,
    })),
    outbox: Object.fromEntries(outboxCounts.map((row) => [row.status, row._count])),
  };

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Email hub</h1>
      <EmailHub data={data} />
    </div>
  );
}
