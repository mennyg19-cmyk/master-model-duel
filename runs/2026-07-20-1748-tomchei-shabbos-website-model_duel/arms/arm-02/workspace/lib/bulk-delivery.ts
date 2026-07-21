import { db } from "@/lib/db";
import { ActionError } from "@/lib/packages/actions";
import { notifyCustomer } from "@/lib/notifications";

/**
 * Staff schedules the bulk-delivery drop (R-078): pick a date + window, then
 * every customer with an undelivered bulk package gets one email + one SMS
 * (G-021). The dedupe key is per schedule + customer, so one scheduling act
 * never double-notifies a customer with several packages.
 */
export async function scheduleBulkDelivery(
  seasonId: string,
  input: { date: string; window: string },
  staffId?: string
) {
  const packages = await db.package.findMany({
    where: {
      seasonId,
      fulfillmentMethod: { kind: "BULK_DELIVERY" },
      stage: { notIn: ["SENT", "PICKED_UP"] },
      lines: { some: {} },
    },
    select: {
      id: true,
      lines: { select: { order: { select: { customer: { select: { id: true, email: true, name: true, phone: true } } } } } },
    },
  });
  if (packages.length === 0) {
    throw new ActionError("No undelivered bulk-delivery packages to schedule", 409);
  }

  const customers = new Map<string, { id: string; email: string; name: string; phone: string | null }>();
  for (const pkg of packages) {
    for (const line of pkg.lines) customers.set(line.order.customer.id, line.order.customer);
  }

  const schedule = await db.bulkDeliverySchedule.create({
    data: {
      seasonId,
      scheduledDate: input.date,
      window: input.window,
      packageCount: packages.length,
      customerCount: customers.size,
      createdByStaffId: staffId,
    },
  });

  let notified = 0;
  for (const customer of customers.values()) {
    notified += await notifyCustomer(customer, {
      kind: "bulk_delivery_scheduled",
      subject: `Your Mishloach Manos delivery is scheduled for ${input.date}`,
      body: `${customer.name}, your bulk delivery is scheduled for ${input.date}, ${input.window}. No need to be home — packages are left at the door.`,
      // Keyed by the scheduling INTENT (season+date+window), not the schedule
      // row id — a double-click or re-submit on timeout never double-notifies.
      dedupeKey: `bulk|${seasonId}|${input.date}|${input.window}|${customer.id}`,
    });
  }
  return { schedule, notified, customers: customers.size, packages: packages.length };
}
