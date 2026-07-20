import type { PrismaClient } from "@prisma/client";

export async function loadEmailHubState(prisma: PrismaClient) {
  const [lists, templates, campaigns, recentMessages] = await Promise.all([
    prisma.emailList.findMany({ orderBy: { name: "asc" } }),
    prisma.emailTemplate.findMany({ orderBy: { name: "asc" } }),
    prisma.emailCampaign.findMany({
      include: { emailList: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.messageOutbox.findMany({
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
        createdAt: true,
      },
    }),
  ]);
  return { lists, templates, campaigns, recentMessages };
}
