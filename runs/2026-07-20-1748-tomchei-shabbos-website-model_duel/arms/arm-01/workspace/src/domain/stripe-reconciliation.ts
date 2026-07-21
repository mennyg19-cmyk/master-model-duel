import type { Prisma, PrismaClient } from "@prisma/client";
import { getStripe } from "@/lib/stripe";

export type ProviderIntentSnapshot = {
  id: string;
  amount: number;
  status: string;
  orderId?: string;
};

async function readProviderIntents() {
  const stripe = getStripe();
  if (!stripe) return [];
  const intents: ProviderIntentSnapshot[] = [];
  let startingAfter: string | undefined;
  do {
    const page = await stripe.paymentIntents.list({
      limit: 100,
      starting_after: startingAfter,
    });
    intents.push(...page.data.map((intent) => ({
      id: intent.id,
      amount: intent.amount,
      status: intent.status,
      orderId: intent.metadata.orderId,
    })));
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);
  return intents;
}

export async function reconcileStripePayments(
  db: PrismaClient,
  runKey: string,
  initiatedById?: string,
  suppliedProviderIntents?: ProviderIntentSnapshot[],
) {
  const existing = await db.reconciliationRun.findUnique({ where: { runKey } });
  if (existing?.status === "COMPLETED") return existing;
  await db.reconciliationRun.upsert({
    where: { runKey },
    update: { status: "RUNNING", initiatedById },
    create: {
      runKey,
      status: "RUNNING",
      findings: [],
      initiatedById,
    },
  });

  const [storedIntents, stripePayments, providerIntents] = await Promise.all([
    db.stripePaymentIntent.findMany({
      select: {
        orderId: true,
        stripePaymentIntentId: true,
        status: true,
        amountCents: true,
      },
    }),
    db.payment.findMany({
      where: { method: "STRIPE", status: "POSTED" },
      select: { orderId: true, reference: true, amountCents: true },
    }),
    suppliedProviderIntents ?? readProviderIntents(),
  ]);
  const storedByProviderId = new Map(
    storedIntents.map((intent) => [intent.stripePaymentIntentId, intent]),
  );
  const paymentsByReference = new Map(
    stripePayments
      .filter((payment) => payment.reference)
      .map((payment) => [payment.reference as string, payment]),
  );
  const findings: Array<{
    identityKey: string;
    findingType: string;
    providerObjectId: string;
    orderId?: string;
    amountCents?: number;
    details: Prisma.InputJsonValue;
  }> = [];

  for (const intent of storedIntents) {
    const payment = paymentsByReference.get(intent.stripePaymentIntentId);
    if (intent.status === "SUCCEEDED" && !payment) {
      findings.push({
        identityKey: `succeeded-without-payment:${intent.stripePaymentIntentId}`,
        findingType: "SUCCEEDED_WITHOUT_PAYMENT",
        providerObjectId: intent.stripePaymentIntentId,
        orderId: intent.orderId,
        amountCents: intent.amountCents,
        details: { storedStatus: intent.status },
      });
    } else if (payment && payment.amountCents !== intent.amountCents) {
      findings.push({
        identityKey: `amount-mismatch:${intent.stripePaymentIntentId}`,
        findingType: "AMOUNT_MISMATCH",
        providerObjectId: intent.stripePaymentIntentId,
        orderId: intent.orderId,
        amountCents: intent.amountCents,
        details: { paymentAmountCents: payment.amountCents },
      });
    }
  }
  for (const providerIntent of providerIntents) {
    if (!storedByProviderId.has(providerIntent.id)) {
      findings.push({
        identityKey: `orphan-provider-intent:${providerIntent.id}`,
        findingType: "ORPHAN_PROVIDER_INTENT",
        providerObjectId: providerIntent.id,
        orderId: providerIntent.orderId,
        amountCents: providerIntent.amount,
        details: { providerStatus: providerIntent.status },
      });
    }
  }
  const storedFindingIds = new Set(
    findings
      .map((finding) => finding.providerObjectId)
      .filter((providerId) => storedByProviderId.has(providerId)),
  );

  await db.$transaction(async (transaction) => {
    for (const finding of findings) {
      await transaction.reconciliationFinding.upsert({
        where: { identityKey: finding.identityKey },
        update: {
          findingType: finding.findingType,
          providerObjectId: finding.providerObjectId,
          orderId: finding.orderId,
          amountCents: finding.amountCents,
          details: finding.details,
          resolvedAt: null,
        },
        create: finding,
      });
    }
    await transaction.reconciliationRun.update({
      where: { runKey },
      data: {
        status: "COMPLETED",
        matchedCount: storedIntents.length - storedFindingIds.size,
        findingCount: findings.length,
        findings,
        finishedAt: new Date(),
      },
    });
  });
  return db.reconciliationRun.findUniqueOrThrow({ where: { runKey } });
}
