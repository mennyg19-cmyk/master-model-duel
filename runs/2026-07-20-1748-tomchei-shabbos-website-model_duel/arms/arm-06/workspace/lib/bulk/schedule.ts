import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { DomainRuleError } from "@/lib/errors";
import { groupByCustomer } from "@/lib/notify/by-customer";
import { sendNotification } from "@/lib/notify/outbox";
import { loadTerminalStages } from "@/lib/packages/stages";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSetting } from "@/lib/settings";
import { BRAND } from "@/lib/brand";

// G-021/R-079: staff-scheduled bulk delivery. One action snapshots every
// unscheduled non-terminal bulk package into a schedule, stamps the delivery
// day on the members, and sends exactly one email + one SMS per DISTINCT
// customer. Membership is persisted (PrintBatchItem discipline), so the
// notified set is provable and a late order simply lands in the next run.

export interface BulkScheduleResult {
  scheduleId: string;
  deliveryDay: string;
  packageCount: number;
  customerCount: number;
  notifiedChannels: { email: number; sms: number };
}

export async function scheduleBulkDelivery(input: {
  deliveryDay: string;
  window?: string;
  ctx: AuditContextLike;
}): Promise<BulkScheduleResult> {
  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError("No open season — bulk scheduling only acts on the open season's packages");
  const days = (await getSetting("delivery.days")) ?? [];
  if (!days.includes(input.deliveryDay)) {
    throw new DomainRuleError(
      `Delivery day "${input.deliveryDay}" is not one of the manager-set days (${days.join(", ") || "none configured"})`,
    );
  }
  const terminalStages = await loadTerminalStages();

  const candidates = await prisma.package.findMany({
    where: {
      order: { seasonId: season.id, status: "FINALIZED" },
      channel: "BULK_DELIVERY",
      stage: { notIn: terminalStages },
      bulkScheduleItems: { none: {} },
    },
    include: {
      order: { select: { id: true, wireFormat: true, customerId: true, customer: { select: { name: true, email: true, phone: true } } } },
    },
    orderBy: { id: "asc" },
  });
  if (candidates.length === 0) {
    throw new DomainRuleError("No unscheduled bulk-delivery packages; expected finalized BULK_DELIVERY packages to schedule");
  }

  const byCustomer = groupByCustomer(
    candidates,
    (pkg) => pkg.order.customerId,
    (pkg) => pkg.order.customer,
    (pkg) => pkg.recipientName,
    (pkg) => pkg.order.id,
  );

  // M3: re-notify dedupe is per (customer, deliveryDay), not per package. A
  // customer already emailed "your Day A delivery is scheduled" by an earlier
  // schedule never gets a SECOND Day A email when late-finalized packages
  // join a later Day A run — one heads-up per delivery day, ever. (A
  // DIFFERENT day is new information and still notifies.) The package board
  // and door list stay the truth for what ships.
  const customerIds = [...byCustomer.keys()];
  const alreadyNotifiedItems = await prisma.bulkDeliveryScheduleItem.findMany({
    where: {
      customerId: { in: customerIds },
      schedule: { seasonId: season.id, deliveryDay: input.deliveryDay, notifiedAt: { not: null } },
    },
    select: { customerId: true },
  });
  const alreadyNotifiedForDay = new Set(alreadyNotifiedItems.map((item) => item.customerId));

  const scheduled = await prisma.$transaction(async (tx) => {
    const schedule = await tx.bulkDeliverySchedule.create({
      data: {
        seasonId: season.id,
        deliveryDay: input.deliveryDay,
        window: input.window?.trim() || null,
        packageCount: candidates.length,
        customerCount: byCustomer.size,
        createdById: input.ctx.staff.id,
      },
    });
    await tx.bulkDeliveryScheduleItem.createMany({
      data: candidates.map((pkg) => ({
        scheduleId: schedule.id,
        packageId: pkg.id,
        orderId: pkg.order.id,
        customerId: pkg.order.customerId,
      })),
    });
    // The schedule day lands on the member packages so the package board and
    // the door work from the same truth.
    await tx.package.updateMany({
      where: { id: { in: candidates.map((pkg) => pkg.id) } },
      data: { deliveryDay: input.deliveryDay, version: { increment: 1 } },
    });

    let email = 0;
    let sms = 0;
    let reNotifySkipped = 0;
    for (const [customerId, entry] of byCustomer) {
      if (alreadyNotifiedForDay.has(customerId)) {
        reNotifySkipped += 1;
        continue;
      }
      const channels = await sendNotification(
        {
          kind: "bulk_scheduled",
          recipient: { email: entry.customer.email, phone: entry.customer.phone },
          subject: `${BRAND.orgName}: your delivery is scheduled for ${input.deliveryDay}`,
          body: `Hello ${entry.customer.name},\n\nYour ${BRAND.orgName} bulk delivery is scheduled for ${input.deliveryDay}${input.window ? ` (${input.window})` : ""}. Packages heading to: ${entry.recipients.join(", ")}.\n\nThank you for supporting ${BRAND.orgName}.`,
          smsBody: `${BRAND.orgName}: bulk delivery scheduled for ${input.deliveryDay}${input.window ? ` (${input.window})` : ""}.`,
          orderId: [...entry.orderIds][0],
          // m6: the FK carries the first order; metadata carries them ALL.
          metadata: { scheduleId: schedule.id, packageCount: entry.recipients.length, orderIds: [...entry.orderIds] },
        },
        tx,
      );
      email += channels.filter((channel) => channel === "EMAIL").length;
      sms += channels.filter((channel) => channel === "SMS").length;
    }
    const notified = await tx.bulkDeliverySchedule.update({
      where: { id: schedule.id },
      data: { notifiedAt: new Date() },
    });
    return { scheduleId: notified.id, email, sms, reNotifySkipped };
  });

  await recordAudit({
    ctx: input.ctx,
    action: "bulk_schedule",
    targetType: "BulkDeliverySchedule",
    targetId: scheduled.scheduleId,
    metadata: {
      deliveryDay: input.deliveryDay,
      window: input.window ?? null,
      packageCount: candidates.length,
      customerCount: byCustomer.size,
      reNotifySkipped: scheduled.reNotifySkipped,
    },
  });

  return {
    scheduleId: scheduled.scheduleId,
    deliveryDay: input.deliveryDay,
    packageCount: candidates.length,
    customerCount: byCustomer.size,
    notifiedChannels: { email: scheduled.email, sms: scheduled.sms },
  };
}

export async function listBulkSchedules(seasonId: string) {
  return prisma.bulkDeliverySchedule.findMany({
    where: { seasonId },
    orderBy: { createdAt: "desc" },
  });
}

export async function countUnscheduledBulkPackages(seasonId: string): Promise<number> {
  const terminalStages = await loadTerminalStages();
  return prisma.package.count({
    where: {
      order: { seasonId, status: "FINALIZED" },
      channel: "BULK_DELIVERY",
      stage: { notIn: terminalStages },
      bulkScheduleItems: { none: {} },
    },
  });
}
