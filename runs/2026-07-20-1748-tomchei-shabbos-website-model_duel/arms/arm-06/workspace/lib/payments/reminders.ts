import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { sendNotification } from "@/lib/notify/outbox";
import { getSetting } from "@/lib/settings";
import { BRAND } from "@/lib/brand";

// R-080: the payment-reminder sweep. A finalized order with an outstanding
// balance gets its first reminder once it is initialAfterDays old, then one
// reminder per intervalDays — lastPaymentReminderAt is the dedupe, so the
// cron can run hourly without spamming. Every run leaves a CronRun row.

export interface PaymentReminderResult {
  cronRunId: string;
  candidates: number;
  reminded: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function sweepPaymentReminders(seasonId: string): Promise<PaymentReminderResult> {
  const policy = await getSetting("payments.reminders");
  if (!policy) {
    throw new DomainRuleError("payments.reminders is not configured; expected the seeded reminder cadence before running the sweep");
  }
  const cronRun = await prisma.cronRun.create({ data: { name: "payment-reminders" } });
  try {
    const initialCutoff = new Date(Date.now() - policy.initialAfterDays * DAY_MS);
    const intervalCutoff = new Date(Date.now() - policy.intervalDays * DAY_MS);

    const candidates = await prisma.order.findMany({
      where: {
        seasonId,
        status: "FINALIZED",
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        createdAt: { lt: initialCutoff },
        OR: [{ lastPaymentReminderAt: null }, { lastPaymentReminderAt: { lt: intervalCutoff } }],
      },
      include: {
        customer: { select: { name: true, email: true } },
        payments: { where: { status: "POSTED" }, select: { amountCents: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    let reminded = 0;
    for (const order of candidates) {
      const paidCents = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      const outstandingCents = order.totalCents - paidCents;
      if (outstandingCents <= 0) continue;
      const outstanding = (outstandingCents / 100).toFixed(2);
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { lastPaymentReminderAt: new Date() } });
        await sendNotification(
          {
            kind: "payment_reminder",
            recipient: { email: order.customer.email },
            subject: `${BRAND.orgName}: balance due on order ${order.wireFormat ?? order.id}`,
            body: `Hello ${order.customer.name},\n\nYour ${BRAND.orgName} order ${order.wireFormat ?? order.id} has an outstanding balance of $${outstanding}. Please pay at your earliest convenience.\n\nThank you for supporting ${BRAND.orgName}.`,
            orderId: order.id,
            metadata: { outstandingCents },
          },
          tx,
        );
      });
      reminded += 1;
    }

    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "OK", finishedAt: new Date(), message: `${reminded} reminder(s) sent for ${candidates.length} candidate order(s)` },
    });
    return { cronRunId: cronRun.id, candidates: candidates.length, reminded };
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "FAILED", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
