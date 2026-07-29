import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { DomainRuleError } from "@/lib/errors";
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

  const byCustomer = new Map<string, { customer: { name: string; email: string; phone: string | null }; orderIds: Set<string>; recipients: string[] }>();
  for (const pkg of candidates) {
    const entry = byCustomer.get(pkg.order.customerId) ?? { customer: pkg.order.customer, orderIds: new Set<string>(), recipients: [] };
    entry.orderIds.add(pkg.order.id);
    entry.recipients.push(pkg.recipientName);
    byCustomer.set(pkg.order.customerId, entry);
  }

  const result = await prisma.$transaction(async (tx) => {
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
    for (const [, entry] of byCustomer) {
      const orderId = [...entry.orderIds][0];
      const channels = await sendNotification(
        {
          kind: "bulk_scheduled",
          recipient: { email: entry.customer.email, phone: entry.customer.phone },
          subject: `${BRAND.orgName}: your delivery is scheduled for ${input.deliveryDay}`,
          body: `Hello ${entry.customer.name},\n\nYour ${BRAND.orgName} bulk delivery is scheduled for ${input.deliveryDay}${input.window ? ` (${input.window})` : ""}. Packages heading to: ${entry.recipients.join(", ")}.\n\nThank you for supporting ${BRAND.orgName}.`,
          smsBody: `${BRAND.orgName}: bulk delivery scheduled for ${input.deliveryDay}${input.window ? ` (${input.window})` : ""}.`,
          orderId,
          metadata: { scheduleId: schedule.id, packageCount: entry.recipients.length },
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
    return { scheduleId: notified.id, email, sms };
  });

  await recordAudit({
    ctx: input.ctx,
    action: "bulk_schedule",
    targetType: "BulkDeliverySchedule",
    targetId: result.scheduleId,
    metadata: {
      deliveryDay: input.deliveryDay,
      window: input.window ?? null,
      packageCount: candidates.length,
      customerCount: byCustomer.size,
    },
  });

  return {
    scheduleId: result.scheduleId,
    deliveryDay: input.deliveryDay,
    packageCount: candidates.length,
    customerCount: byCustomer.size,
    notifiedChannels: { email: result.email, sms: result.sms },
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
