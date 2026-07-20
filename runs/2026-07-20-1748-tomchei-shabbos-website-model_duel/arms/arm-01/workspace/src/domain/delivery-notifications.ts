import type { Prisma, PrismaClient } from "@prisma/client";

type NotificationClient = PrismaClient | Prisma.TransactionClient;

export async function captureCustomerNotification(
  prisma: NotificationClient,
  input: {
    customerId: string;
    packageId?: string;
    eventKey: string;
    channel: "EMAIL" | "SMS";
    destination: string | null;
    payload: Prisma.InputJsonValue;
  },
) {
  if (!input.destination) return null;
  return prisma.notificationCapture.upsert({
    where: {
      eventKey_channel: {
        eventKey: input.eventKey,
        channel: input.channel,
      },
    },
    create: {
      customerId: input.customerId,
      packageId: input.packageId,
      eventKey: input.eventKey,
      channel: input.channel,
      destination: input.destination,
      payload: input.payload,
    },
    update: {},
  });
}

export async function captureEmailAndSms(
  prisma: NotificationClient,
  input: {
    customerId: string;
    packageId?: string;
    eventKey: string;
    email: string | null;
    phone: string | null;
    payload: Prisma.InputJsonValue;
  },
) {
  return Promise.all([
    captureCustomerNotification(prisma, {
      ...input,
      channel: "EMAIL",
      destination: input.email,
    }),
    captureCustomerNotification(prisma, {
      ...input,
      channel: "SMS",
      destination: input.phone,
    }),
  ]);
}
