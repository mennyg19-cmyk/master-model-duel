import { db } from "@/lib/db";
import { newDraftReference } from "@/lib/domain/draft-reference";
import { finalizeOrder } from "@/lib/domain/finalize";

// Test-environment console actions (R-014, R-103). Destructive by design and
// therefore ONLY reachable in test mode (the API route enforces isTestMode).
// Wipe clears every transactional row for the open season — orders, packages,
// prints, routes, shipments, drafts, notifications, this season's recon flags
// and inventory reservations — but never touches the catalog, customers,
// staff, settings, audit log, the webhook idempotency ledger, or any other
// season's rows, so wipe + seed restores a clean test season without
// rebuilding reference data or erasing cross-season history.

export type WipeCounts = Record<string, number>;

export async function wipeOpenSeason(): Promise<{ seasonName: string; counts: WipeCounts }> {
  const season = await db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
  if (!season) throw new Error("No open season to wipe");
  const seasonId = season.id;
  const counts: WipeCounts = {};
  const record = (name: string, result: { count: number }) => (counts[name] = result.count);

  // FK-safe order: leaves first. Runs as one transaction so an interrupted
  // wipe never strands half a season.
  await db.$transaction(async (tx) => {
    record("routeLinks", await tx.routeLink.deleteMany({ where: { route: { seasonId } } }));
    record("routeStops", await tx.routeStop.deleteMany({ where: { route: { seasonId } } }));
    record("routes", await tx.deliveryRoute.deleteMany({ where: { seasonId } }));
    record("shipments", await tx.shipment.deleteMany({ where: { package: { seasonId } } }));
    record("quoteOptions", await tx.shippingQuoteOption.deleteMany({
      where: { quote: { OR: [{ order: { seasonId } }, { package: { seasonId } }, { orderId: null, packageId: null }] } },
    }));
    record("quotes", await tx.shippingQuote.deleteMany({
      where: { OR: [{ order: { seasonId } }, { package: { seasonId } }, { orderId: null, packageId: null }] },
    }));
    record("printArtifacts", await tx.printArtifact.deleteMany({ where: { printBatch: { seasonId } } }));
    record("printBatches", await tx.printBatch.deleteMany({ where: { seasonId } }));
    const orderIds = (await tx.order.findMany({ where: { seasonId }, select: { id: true } })).map((row) => row.id);
    const packageIds = (await tx.package.findMany({ where: { seasonId }, select: { id: true } })).map((row) => row.id);
    record("notifications", await tx.notification.deleteMany({
      where: { OR: [{ orderId: { in: orderIds } }, { packageId: { in: packageIds } }] },
    }));
    record("lineAddOns", await tx.orderLineAddOn.deleteMany({ where: { orderLine: { order: { seasonId } } } }));
    record("lineOptions", await tx.orderLineOption.deleteMany({ where: { orderLine: { order: { seasonId } } } }));
    record("lines", await tx.orderLine.deleteMany({ where: { order: { seasonId } } }));
    record("packageAudits", await tx.packageAudit.deleteMany({ where: { package: { seasonId } } }));
    record("packages", await tx.package.deleteMany({ where: { seasonId } }));
    record("payments", await tx.payment.deleteMany({ where: { order: { seasonId } } }));
    record("checkoutSessions", await tx.stripeCheckoutSession.deleteMany({ where: { order: { seasonId } } }));
    record("paymentIntents", await tx.stripePaymentIntent.deleteMany({ where: { order: { seasonId } } }));
    // StripeWebhookEvent is a global idempotency ledger with no season link —
    // like the audit log it survives a wipe (new test flows mint new event ids).
    record("reconFlags", await tx.paymentReconFlag.deleteMany({ where: { orderId: { in: orderIds } } }));
    record("orders", await tx.order.deleteMany({ where: { seasonId } }));
    record("drafts", await tx.orderDraft.deleteMany({ where: { seasonId } }));
    record("bulkSchedules", await tx.bulkDeliverySchedule.deleteMany({ where: { seasonId } }));
    // Fresh counters: order numbers restart, this season's reservations release.
    await tx.season.update({ where: { id: seasonId }, data: { orderCounter: 0 } });
    await tx.inventoryItem.updateMany({
      where: { OR: [{ product: { seasonId } }, { addOn: { seasonId } }] },
      data: { reserved: 0 },
    });
  }, { timeout: 120_000 });

  return { seasonName: season.name, counts };
}

/** One finalized demo order (same shape as the baseline seed) so a wiped season isn't empty. */
export async function seedDemoOrder(): Promise<{ orderNumber: number | null }> {
  const season = await db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
  if (!season) throw new Error("No open season to seed");
  const product = await db.product.findFirst({ where: { seasonId: season.id, slug: "classic-basket" } });
  if (!product) throw new Error("Baseline catalog missing — run db:seed first");
  const customer = await db.customer.findUnique({ where: { email: "sample.customer@example.com" } });
  if (!customer) throw new Error("Sample customer missing — run db:seed first");
  const delivery = await db.fulfillmentMethod.findUniqueOrThrow({ where: { code: "local_delivery" } });

  const order = await db.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      draftReference: newDraftReference(),
      itemsCents: product.basePriceCents * 2,
      totalCents: product.basePriceCents * 2,
      lines: {
        create: [1, 2].map(() => ({
          productId: product.id,
          unitPriceCents: product.basePriceCents,
          recipientName: "Rivka Friedman",
          addressLine1: "12 Main St",
          city: "Lakewood",
          state: "NJ",
          zip: "08701",
          fulfillmentMethodId: delivery.id,
          greeting: "A freilichen Purim!",
        })),
      },
    },
  });
  const finalized = await finalizeOrder(order.id);
  return { orderNumber: finalized.orderNumber };
}
