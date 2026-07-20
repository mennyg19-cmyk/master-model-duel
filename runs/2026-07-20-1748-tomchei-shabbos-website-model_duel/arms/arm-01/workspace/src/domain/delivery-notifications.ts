import { MessageChannel, type Prisma, type PrismaClient } from "@prisma/client";
import { enqueueMessage } from "@/domain/messaging-outbox";
import { enqueueTransactionalEmail } from "@/domain/messaging-templates";

type NotificationClient = PrismaClient | Prisma.TransactionClient;

export async function captureCustomerNotification(
  prisma: NotificationClient,
  input: {
    customerId: string;
    packageId?: string;
    eventKey: string;
    channel: MessageChannel;
    destination: string | null;
    payload: Prisma.InputJsonValue;
  },
) {
  if (!input.destination) return null;
  const payload =
    typeof input.payload === "object" && !Array.isArray(input.payload)
      ? (input.payload as Record<string, Prisma.JsonValue>)
      : {};
  const type = typeof payload.type === "string" ? payload.type : "CUSTOMER_UPDATE";
  if (input.channel === MessageChannel.EMAIL) {
    const templates = {
      DAY_OF_DELIVERY: {
        templateKey: "delivery.day_of",
        variables: {
          recipientName:
            typeof payload.recipientName === "string"
              ? payload.recipientName
              : "your recipient",
        },
      },
      PICKUP_READY: {
        templateKey: "pickup.ready",
        variables: {
          pickupLocation:
            typeof payload.pickupLocation === "string"
              ? payload.pickupLocation
              : "the pickup location",
        },
      },
      BULK_DELIVERY_SCHEDULED: {
        templateKey: "delivery.bulk",
        variables: {
          deliveryWindow:
            typeof payload.deliveryWindow === "string"
              ? payload.deliveryWindow
              : "the scheduled window",
        },
      },
    } as const;
    const template = templates[type as keyof typeof templates];
    if (!template) {
      throw new Error(`No transactional email template is mapped for ${type}.`);
    }
    return enqueueTransactionalEmail(prisma, {
      idempotencyKey: `${input.eventKey}:${input.channel}`,
      templateKey: template.templateKey,
      recipient: input.destination,
      variables: template.variables,
      customerId: input.customerId,
      packageId: input.packageId,
    });
  }
  const messageText = type
    .split("_")
    .map((part) => part.toLowerCase())
    .join(" ");
  return enqueueMessage(prisma, {
    idempotencyKey: `${input.eventKey}:${input.channel}`,
    eventKey: input.eventKey,
    channel: input.channel,
    recipient: input.destination,
    textBody: `Tomchei Shabbos update: ${messageText}.`,
    customerId: input.customerId,
    packageId: input.packageId,
    payload: input.payload,
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
      channel: MessageChannel.EMAIL,
      destination: input.email,
    }),
    captureCustomerNotification(prisma, {
      ...input,
      channel: MessageChannel.SMS,
      destination: input.phone,
    }),
  ]);
}
