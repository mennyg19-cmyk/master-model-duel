import { AuditAction, CronRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { captureEmailAndSms } from "@/lib/notify/outbox";

export async function runPickupExpiryCron() {
  const run = await db.cronRunLog.create({
    data: { jobName: "pickup-expiry", status: CronRunStatus.RUNNING },
  });
  try {
    const now = new Date();
    const expired = await db.package.findMany({
      where: {
        fulfillmentMethod: { code: "PICKUP" },
        pickupExpiresAt: { lt: now },
        pickedUpAt: null,
        pickupReadyAt: { not: null },
      },
      include: { order: { include: { customer: true } } },
    });

    let notified = 0;
    for (const pkg of expired) {
      const customer = pkg.order.customer;
      const recipientKey =
        customer?.emailNorm || customer?.phoneNorm || customer?.id || pkg.orderId;
      const result = await captureEmailAndSms({
        templateKey: "pickup-expired",
        recipientKey,
        idempotencyBase: `pickup-expired:${pkg.id}`,
        emailSubject: "Pickup window expired",
        emailBody: `Pickup for ${pkg.recipientName} has expired.`,
        smsBody: `TS: pickup expired for ${pkg.recipientName}.`,
        meta: { packageId: pkg.id },
      });
      if (result.email.created || result.sms.created) notified += 1;
    }

    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: CronRunStatus.SUCCEEDED,
        finishedAt: new Date(),
        message: `expired=${expired.length} notified=${notified}`,
        meta: { expiredIds: expired.map((p) => p.id) },
      },
    });
    return { expired: expired.length, notified };
  } catch (error) {
    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: CronRunStatus.FAILED,
        finishedAt: new Date(),
        message: error instanceof Error ? error.message : "failed",
      },
    });
    throw error;
  }
}

export async function runPaymentReminderCron() {
  const run = await db.cronRunLog.create({
    data: { jobName: "payment-reminder", status: CronRunStatus.RUNNING },
  });
  try {
    const unpaid = await db.order.findMany({
      where: {
        status: { in: ["PLACED", "PAID"] },
        paymentStatusCached: { in: ["UNPAID", "PARTIAL"] },
      },
      include: { customer: true },
      take: 200,
    });

    let sent = 0;
    for (const order of unpaid) {
      if (order.paymentStatusCached === "PAID") continue;
      const customer = order.customer;
      const recipientKey =
        customer?.emailNorm || customer?.phoneNorm || customer?.id || order.id;
      const result = await captureEmailAndSms({
        templateKey: "payment-reminder",
        recipientKey,
        idempotencyBase: `payment-reminder:${order.id}:${new Date().toISOString().slice(0, 10)}`,
        emailSubject: "Payment reminder",
        emailBody: `Balance remains on order ${order.orderNumber ?? order.draftRef}.`,
        smsBody: `TS: payment reminder for order ${order.orderNumber ?? order.draftRef}.`,
        meta: { orderId: order.id },
      });
      if (result.email.created || result.sms.created) sent += 1;
    }

    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: CronRunStatus.SUCCEEDED,
        finishedAt: new Date(),
        message: `candidates=${unpaid.length} sent=${sent}`,
      },
    });
    return { candidates: unpaid.length, sent };
  } catch (error) {
    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: CronRunStatus.FAILED,
        finishedAt: new Date(),
        message: error instanceof Error ? error.message : "failed",
      },
    });
    throw error;
  }
}

export async function scheduleBulkDelivery(input: {
  seasonId: string;
  packageIds: string[];
  deliveryDate: Date;
  windowLabel?: string;
  actorId?: string | null;
}) {
  const packages = await db.package.findMany({
    where: {
      id: { in: input.packageIds },
      order: { seasonId: input.seasonId },
      fulfillmentMethod: { code: { in: ["BULK_DELIVERY", "DELIVERY"] } },
    },
    include: {
      order: { include: { customer: true } },
    },
  });
  if (packages.length !== input.packageIds.length) {
    throw new Error("Some packages missing or not bulk delivery");
  }

  const window = await db.$transaction(async (tx) => {
    const created = await tx.bulkDeliveryWindow.create({
      data: {
        seasonId: input.seasonId,
        deliveryDate: input.deliveryDate,
        windowLabel: input.windowLabel ?? null,
        scheduledById: input.actorId ?? null,
      },
    });
    await tx.package.updateMany({
      where: { id: { in: input.packageIds } },
      data: { bulkWindowId: created.id },
    });
    await writeAudit(
      {
        action: AuditAction.BULK_DELIVERY_SCHEDULED,
        actorId: input.actorId,
        meta: {
          windowId: created.id,
          packageIds: input.packageIds,
          deliveryDate: input.deliveryDate.toISOString(),
        },
      },
      tx,
    );
    return created;
  });

  const seen = new Set<string>();
  for (const pkg of packages) {
    const customer = pkg.order.customer;
    const recipientKey =
      customer?.emailNorm || customer?.phoneNorm || customer?.id || pkg.orderId;
    if (seen.has(recipientKey)) continue;
    seen.add(recipientKey);
    await captureEmailAndSms({
      templateKey: "bulk-delivery-scheduled",
      recipientKey,
      idempotencyBase: `bulk-sched:${window.id}:${recipientKey}`,
      emailSubject: "Bulk delivery scheduled",
      emailBody: `Your bulk delivery is scheduled for ${input.deliveryDate.toISOString().slice(0, 10)}${input.windowLabel ? ` (${input.windowLabel})` : ""}.`,
      smsBody: `TS: bulk delivery ${input.deliveryDate.toISOString().slice(0, 10)}.`,
      meta: { windowId: window.id },
      actorId: input.actorId,
    });
  }

  await db.bulkDeliveryWindow.update({
    where: { id: window.id },
    data: { notifiedAt: new Date() },
  });

  return { window, notifiedCustomers: seen.size };
}

/** Follow-up call-center filters (R-079). */
export async function followUpQueue(input: {
  seasonId: string;
  filter?: "unpaid" | "unclaimed_pickup" | "bulk_pending" | "all";
}) {
  const filter = input.filter ?? "all";
  const unpaid =
    filter === "unpaid" || filter === "all"
      ? await db.order.findMany({
          where: {
            seasonId: input.seasonId,
            paymentStatusCached: { in: ["UNPAID", "PARTIAL"] },
          },
          include: { customer: true },
          take: 100,
        })
      : [];
  const unclaimed =
    filter === "unclaimed_pickup" || filter === "all"
      ? await db.package.findMany({
          where: {
            order: { seasonId: input.seasonId },
            fulfillmentMethod: { code: "PICKUP" },
            pickupReadyAt: { not: null },
            pickedUpAt: null,
          },
          include: { order: { include: { customer: true } } },
          take: 100,
        })
      : [];
  const bulk =
    filter === "bulk_pending" || filter === "all"
      ? await db.package.findMany({
          where: {
            order: { seasonId: input.seasonId },
            fulfillmentMethod: { code: { in: ["BULK_DELIVERY", "DELIVERY"] } },
            bulkWindowId: null,
            stage: { notIn: ["SENT", "PICKED_UP"] },
          },
          include: { order: { include: { customer: true } } },
          take: 100,
        })
      : [];
  return { unpaid, unclaimed, bulk };
}
