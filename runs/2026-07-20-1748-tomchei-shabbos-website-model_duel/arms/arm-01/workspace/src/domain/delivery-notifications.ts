import { MessageChannel, type Prisma, type PrismaClient } from "@prisma/client";
import { enqueueMessage } from "@/domain/messaging";

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
  const payload =
    typeof input.payload === "object" && !Array.isArray(input.payload)
      ? (input.payload as Record<string, Prisma.JsonValue>)
      : {};
  const type = typeof payload.type === "string" ? payload.type : "CUSTOMER_UPDATE";
  const messageText = type
    .split("_")
    .map((part) => part.toLowerCase())
    .join(" ");
  return enqueueMessage(prisma, {
    idempotencyKey: `${input.eventKey}:${input.channel}`,
    eventKey: input.eventKey,
    channel: MessageChannel[input.channel],
    recipient: input.destination,
    subject:
      input.channel === "EMAIL"
        ? `Tomchei Shabbos: ${messageText}`
        : undefined,
    htmlBody:
      input.channel === "EMAIL"
        ? `<p>${messageText}</p>`
        : undefined,
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
