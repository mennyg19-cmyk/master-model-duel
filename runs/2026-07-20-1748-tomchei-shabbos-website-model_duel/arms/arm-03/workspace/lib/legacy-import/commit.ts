import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/customers";
import { newDraftReference } from "@/lib/domain/draft-reference";
import type { LegacyPlan } from "@/lib/legacy-import/plan";

// Legacy migration pipeline, commit half (R-165, R-186, G-029, UR-014). The
// plan is built in ./plan; this writes it in four staged atomic transactions
// (catalog -> customers -> addresses -> orders); each stage records a
// LegacyImportStage row inside its own transaction, so an interruption
// between stages resumes exactly where it stopped.

const STAGES = ["catalog", "customers", "addresses", "orders"] as const;
export type LegacyStage = (typeof STAGES)[number];

export type CommitResult = {
  runId: string;
  completedStages: { stage: string; counts: Record<string, number>; skipped: boolean }[];
  status: "COMPLETED" | "COMMITTING";
};

/**
 * Staged atomic commit. Each stage is one transaction that writes its rows AND
 * its LegacyImportStage marker; a crash between stages leaves the run
 * COMMITTING and a re-commit of the same file resumes at the first missing
 * stage. `stopAfterStage` exists for the interruption smoke — it ends the
 * commit cleanly after that stage, exactly like a crash would.
 */
export async function commitLegacyImport(
  runId: string,
  plan: LegacyPlan,
  options: { stopAfterStage?: LegacyStage } = {}
): Promise<CommitResult> {
  await db.legacyImportRun.update({ where: { id: runId }, data: { status: "COMMITTING" } });
  const doneStages = new Set(
    (await db.legacyImportStage.findMany({ where: { runId }, select: { stage: true } })).map((row) => row.stage)
  );
  const completed: CommitResult["completedStages"] = [];

  // Cross-stage id maps are rebuilt from the DB on resume (deterministic keys).
  const customerIds = new Map<string, string>();
  const productIds = new Map<string, string>();
  let seasonId = "";

  const loadCatalogIds = async () => {
    const season = await db.season.findUnique({ where: { name: plan.seasonName } });
    if (!season) throw new Error(`Legacy season ${plan.seasonName} missing — catalog stage did not run`);
    seasonId = season.id;
    const products = await db.product.findMany({ where: { seasonId }, select: { id: true, slug: true } });
    for (const product of products) productIds.set(product.slug, product.id);
  };
  const loadCustomerIds = async () => {
    const rows = await db.customer.findMany({
      where: { email: { in: plan.customers.map((customer) => customer.email) } },
      select: { id: true, email: true },
    });
    const byEmail = new Map(rows.map((row) => [row.email, row.id]));
    for (const customer of plan.customers) {
      const id = customer.existingId ?? byEmail.get(customer.email);
      if (!id) throw new Error(`Customer ${customer.email} missing — customers stage did not run`);
      customerIds.set(customer.key, id);
    }
  };

  for (const stage of STAGES) {
    if (doneStages.has(stage)) {
      completed.push({ stage, counts: {}, skipped: true });
      if (stage === "catalog") await loadCatalogIds();
      if (stage === "customers") await loadCustomerIds();
      continue;
    }

    if (stage === "catalog") {
      await db.$transaction(async (tx) => {
        const season = await tx.season.upsert({
          where: { name: plan.seasonName },
          update: {},
          create: { name: plan.seasonName, status: "CLOSED" },
        });
        seasonId = season.id;
        // Repeat-order bridge (S4): a legacy product points its replacement at
        // the closest-priced active product in the open season, so P10's chain
        // resolution maps imported history onto today's catalog.
        const openSeason = await tx.season.findFirst({ where: { status: "OPEN" } });
        const activeProducts = openSeason
          ? await tx.product.findMany({ where: { seasonId: openSeason.id, isActive: true }, select: { id: true, basePriceCents: true } })
          : [];
        const closestActive = (priceCents: number) =>
          activeProducts.length === 0
            ? null
            : activeProducts.reduce((best, candidate) =>
                Math.abs(candidate.basePriceCents - priceCents) < Math.abs(best.basePriceCents - priceCents) ? candidate : best
              ).id;
        for (const product of plan.products) {
          const row = await tx.product.upsert({
            where: { seasonId_slug: { seasonId, slug: product.slug } },
            update: {},
            create: {
              seasonId,
              name: product.name,
              slug: product.slug,
              basePriceCents: product.priceCents,
              isActive: false,
              description: "Imported from the legacy system.",
              replacementId: closestActive(product.priceCents),
            },
          });
          productIds.set(product.slug, row.id);
        }
        await tx.legacyImportStage.create({
          data: { runId, stage, counts: { seasons: 1, products: plan.products.length } },
        });
      });
      completed.push({ stage, counts: { seasons: 1, products: plan.products.length }, skipped: false });
    }

    if (stage === "customers") {
      await db.$transaction(async (tx) => {
        const taken = new Set(
          (
            await tx.customer.findMany({
              where: { phoneNormalized: { in: plan.customers.map((c) => normalizePhone(c.phone)).filter((p): p is string => !!p) } },
              select: { phoneNormalized: true },
            })
          ).map((row) => row.phoneNormalized as string)
        );
        for (const customer of plan.customers) {
          if (customer.existingId) {
            customerIds.set(customer.key, customer.existingId);
            continue;
          }
          const phoneNormalized = normalizePhone(customer.phone);
          const phoneFree = phoneNormalized !== null && !taken.has(phoneNormalized);
          if (phoneNormalized) taken.add(phoneNormalized);
          const row = await tx.customer.upsert({
            where: { email: customer.email },
            update: {},
            create: {
              email: customer.email,
              name: customer.name,
              phone: customer.phone,
              phoneNormalized: phoneFree ? phoneNormalized : null,
            },
          });
          customerIds.set(customer.key, row.id);
        }
        await tx.legacyImportStage.create({ data: { runId, stage, counts: { customers: plan.customers.length } } });
      });
      completed.push({ stage, counts: { customers: plan.customers.length }, skipped: false });
    }

    if (stage === "addresses") {
      await db.$transaction(async (tx) => {
        let created = 0;
        let flagged = 0;
        for (const address of plan.addresses) {
          const customerId = customerIds.get(address.customerKey);
          if (!customerId) continue;
          const row = await tx.customerAddress.upsert({
            where: { customerId_normalizedKey: { customerId, normalizedKey: address.normalizedKey } },
            update: {},
            create: {
              customerId,
              normalizedKey: address.normalizedKey,
              recipient: address.recipient,
              line1: address.line1,
              city: address.city,
              state: address.state,
              zip: address.zip,
            },
          });
          created += 1;
          if (address.reviewReason) {
            await tx.addressReviewItem.create({
              data: {
                runId,
                customerId,
                addressId: row.id,
                reason: address.reviewReason,
                detail: { sourceLine: address.sourceLine, recipient: address.recipient, line1: address.line1 },
              },
            });
            flagged += 1;
          }
        }
        await tx.legacyImportStage.create({ data: { runId, stage, counts: { addresses: created, flagged } } });
      });
      const flagged = plan.addresses.filter((address) => address.reviewReason).length;
      completed.push({ stage, counts: { addresses: plan.addresses.length, flagged }, skipped: false });
    }

    if (stage === "orders") {
      await db.$transaction(async (tx) => {
        const methods = await tx.fulfillmentMethod.findMany({ select: { id: true, code: true } });
        const methodByCode = new Map(methods.map((method) => [method.code, method.id]));
        const fallbackMethod = methodByCode.get("local_delivery") ?? methods[0].id;
        let orderCount = 0;
        for (const order of plan.orders) {
          const customerId = customerIds.get(order.customerKey);
          if (!customerId) continue;
          await tx.order.create({
            data: {
              seasonId,
              customerId,
              status: "FINALIZED",
              draftReference: newDraftReference(),
              orderNumber: order.orderNumber,
              itemsCents: order.totalCents,
              totalCents: order.totalCents,
              paymentStatus: "PAID",
              finalizedAt: order.finalizedAt,
              createdAt: order.finalizedAt,
              // Historical orders arrive settled: one CHECK row keeps the
              // ledger consistent with paymentStatus (reports reconcile).
              payments: {
                create: { method: "CHECK", amountCents: order.totalCents, note: "Legacy import — settled historically" },
              },
              lines: {
                create: order.lines.map((line) => ({
                  productId: productIds.get(line.productKey)!,
                  quantity: line.quantity,
                  unitPriceCents: line.unitPriceCents,
                  recipientName: line.recipient,
                  addressLine1: line.line1,
                  city: line.city,
                  state: line.state,
                  zip: line.zip,
                  fulfillmentMethodId: methodByCode.get(line.methodCode) ?? fallbackMethod,
                  greeting: line.greeting,
                })),
              },
            },
          });
          orderCount += 1;
        }
        // Never rewind a live counter — take the max of current vs imported.
        const maxNumber = Math.max(0, ...plan.orders.map((order) => order.orderNumber));
        const seasonRow = await tx.season.findUniqueOrThrow({ where: { id: seasonId }, select: { orderCounter: true } });
        await tx.season.update({
          where: { id: seasonId },
          data: { orderCounter: Math.max(seasonRow.orderCounter, maxNumber) },
        });
        await tx.legacyImportStage.create({ data: { runId, stage, counts: { orders: orderCount } } });
      }, { timeout: 60_000 });
      completed.push({ stage, counts: { orders: plan.orders.length }, skipped: false });
    }

    if (options.stopAfterStage === stage) {
      return { runId, completedStages: completed, status: "COMMITTING" };
    }
  }

  await db.legacyImportRun.update({ where: { id: runId }, data: { status: "COMPLETED" } });
  return { runId, completedStages: completed, status: "COMPLETED" };
}
