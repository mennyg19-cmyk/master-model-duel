import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SmsDispatch = {
  packageId?: string;
  customerId?: string;
  event: string;
  dedupeKey: string;
  payload: Prisma.InputJsonValue;
};

export async function dispatchSms(input: SmsDispatch) {
  return prisma.deliveryNotification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: { ...input, channel: "SMS" },
    update: {},
  });
}
