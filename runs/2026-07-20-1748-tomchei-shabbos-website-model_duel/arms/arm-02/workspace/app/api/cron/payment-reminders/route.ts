import { db } from "@/lib/db";
import { requireCronAuth, runCronJob } from "@/lib/cron";
import { captureNotification } from "@/lib/notifications";
import { getOpenSeason } from "@/lib/season";

/**
 * Payment-reminder cron (R-080): finalized orders still UNPAID/PARTIAL get an
 * email reminder, deduped per order per calendar day — running the cron twice
 * the same day never doubles up.
 */
export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const season = await getOpenSeason();
  if (!season) return Response.json({ ok: true, skipped: "no open season" });

  const result = await runCronJob("payment-reminders", async () => {
    const orders = await db.order.findMany({
      where: {
        seasonId: season.id,
        status: "FINALIZED",
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      },
      select: {
        id: true,
        orderNumber: true,
        totalCents: true,
        customer: { select: { id: true, email: true, name: true } },
        payments: { where: { state: "POSTED" }, select: { amountCents: true } },
      },
    });
    const today = new Date().toISOString().slice(0, 10);
    let reminded = 0;
    for (const order of orders) {
      const paid = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      const owedCents = order.totalCents - paid;
      if (owedCents <= 0) continue;
      const sent = await captureNotification({
        channel: "EMAIL",
        recipient: order.customer.email,
        kind: "payment_reminder",
        subject: `Payment reminder — order #${order.orderNumber}`,
        body: `${order.customer.name}, order #${order.orderNumber} has an open balance of $${(owedCents / 100).toFixed(2)}. You can pay online or at the office.`,
        dedupeKey: `payment-reminder|${order.id}|${today}`,
        customerId: order.customer.id,
        orderId: order.id,
      });
      if (sent) reminded += 1;
    }
    return { candidates: orders.length, reminded };
  });
  return Response.json({ ok: true, ...result });
}
