// DB-backed P12 checks (S1–S4 domain behavior): the legacy import pipeline
// (dry-run guard, staged atomic commit, merge-not-duplicate customers,
// order-number repair, stub products), address-book cleanup (UR-014), Stripe
// reconciliation against an in-process fixture double (R-093), export
// datasets (R-092), and the multi-season/margin reports (R-091/UR-003).
//
// The dev DB carries the scale dataset, so every assertion is scoped to this
// file's own rows (unique stamp) rather than global counts.

import http from "node:http";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:4106/app";
process.env.AUTH_SECRET ??= "0123456789abcdef0123456789abcdef";
// The suite exercises the test-class seams (test-ops guard, dev-auth rules):
// declare the class explicitly — B1 made "production" the fail-closed default.
process.env.APP_ENV ??= "test";

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

async function throwsNamed(run: () => Promise<unknown>, name: string): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (error) {
    return (error as Error)?.name === name;
  }
}

// --- Stripe fixture double (fixture mode: key + base URL) --------------------
// In-process so the domain suite never depends on the dev server. Serves the
// one endpoint the matcher lists; the intents below exercise every finding
// kind plus the matched/foreign paths.
const stamp = Date.now().toString(36);
const PI = (suffix: string) => `pi_p12_${suffix}_${stamp}`;

const fixtureIntents: { id: string; amount: number; currency: string; status: string; metadata: { orderId?: string } }[] = [
  { id: PI("ok"), amount: 4200, currency: "usd", status: "succeeded", metadata: { orderId: "LATE" } },
  { id: PI("orphan"), amount: 1000, currency: "usd", status: "succeeded", metadata: { orderId: "LATE" } },
  { id: PI("drift"), amount: 4200, currency: "usd", status: "succeeded", metadata: { orderId: "LATE" } },
  { id: PI("amount"), amount: 4200, currency: "usd", status: "succeeded", metadata: { orderId: "LATE" } },
  { id: PI("nopay"), amount: 4200, currency: "usd", status: "succeeded", metadata: { orderId: "LATE" } },
  { id: PI("foreign"), amount: 9999, currency: "usd", status: "succeeded", metadata: {} },
];

const fixtureServer = http.createServer((request, response) => {
  if (request.url?.startsWith("/v1/payment_intents")) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: fixtureIntents, has_more: false }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: { message: "fixture 404" } }));
});
await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
const fixturePort = (fixtureServer.address() as { port: number }).port;
process.env.STRIPE_BASE_URL = `http://127.0.0.1:${fixturePort}`;
process.env.STRIPE_SECRET_KEY = "sk_test_p12_fixture";

const { prisma } = await import("../lib/db");
const { stageImport, commitImport, discardImport, readPayload } = await import("../lib/imports/engine");
const { IMPORT_HANDLERS } = await import("../lib/imports/kinds");
const { scanBook, mergeAddresses, resolveReview } = await import("../lib/imports/legacy/cleanup");
const { runReconciliation } = await import("../lib/reconcile/matcher");
const { EXPORT_DATASET_LIST } = await import("../lib/exports/datasets");
const { getSeasonPerformance, getMethodDrilldown, getProductDrilldown } = await import("../lib/reports/seasons");
const { getMarginRollup } = await import("../lib/reports/margin");
const { normalizePhone } = await import("../lib/phone");
const { requireTestEnv } = await import("../lib/testops/guard");
const { env } = await import("../lib/env");
const { ENV_SPEC } = await import("../lib/env-spec");
const { expectedCommitPhrase } = await import("../lib/imports/commit-phrase");

// B1: the APP_ENV spec default must be the fail-closed class — a deploy that
// forgets the var keeps destructive test-ops (and the dev seam) disabled.
const appEnvSpec = ENV_SPEC.find((entry) => entry.key === "APP_ENV");
check("APP_ENV fails closed: the spec default is production, never test",
  appEnvSpec !== undefined && appEnvSpec.schema.parse(undefined) === "production" && env.APP_ENV === "test");

const staff = await prisma.staffUser.create({
  data: { email: `p12-staff-${stamp}@example.org`, name: "P12 Staff", role: "MANAGER", status: "ACTIVE", confirmedAt: new Date() },
});
const ctx = { staff: { id: staff.id, email: staff.email }, impersonator: null };

// =============================================================================
// 1. Legacy customers: dry-run guard, staged commit, book merge, flagged ZIP
// =============================================================================
// Phones derive from the clock so fixtures can never collide with the seeded
// Demo Customer (or the scale dataset) and trip the honest merge-by-phone path.
const uniqPhone = (salt: number) => {
  const digits = String(Date.now() + salt).slice(-7);
  return `(732) ${digits.slice(0, 3)}-${digits.slice(3)}`;
};
const bookPhone = uniqPhone(0);
const customerEmail = `p12-book-${stamp}@example.org`;
const customersCsv = [
  "customer_name,email,phone,address_label,line1,city,region,postal_code",
  `RIVKY  WEISS,${customerEmail},${bookPhone},home,12 Hadassah Ln,lakewood,nj,08701`,
  `rivky weiss,${customerEmail},,shul,12 hadassah ln.,LAKEWOOD,NJ,08701-1234`,
  `Rivky Weiss,${customerEmail},,work,40 Pine St,Lakewood,NJ,call me`,
  `RIVKY  WEISS,${customerEmail},${bookPhone},home,12 Hadassah Ln,lakewood,nj,08701`,
].join("\n");

const dryBatch = await stageImport({
  kind: "LEGACY_CUSTOMERS",
  handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS,
  filename: "legacy-customers.csv",
  csvText: customersCsv,
  dryRun: true,
  ctx,
});
check("a dry-run batch stages with the dryRun flag and full verdicts",
  dryBatch.dryRun === true && dryBatch.totalRows === 4 && dryBatch.validRows === 3 && dryBatch.duplicateRows === 1);
check(
  "a dry-run batch can never commit (G-029)",
  await throwsNamed(
    () => commitImport({ batchId: dryBatch.id, handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS, confirmPhrase: expectedCommitPhrase(dryBatch.validRows), ctx }),
    "DomainRuleError",
  ),
);
await discardImport({ batchId: dryBatch.id, ctx });
check("dry-run proves the ledger without writing: no customer landed",
  (await prisma.customer.count({ where: { email: customerEmail } })) === 0);

const stagedBook = await stageImport({
  kind: "LEGACY_CUSTOMERS",
  handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS,
  filename: "legacy-customers.csv",
  csvText: customersCsv,
  ctx,
});
check("a wrong typed phrase refuses the commit before anything writes (B2/G-029)",
  await throwsNamed(
    () => commitImport({ batchId: stagedBook.id, handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS, confirmPhrase: "yes commit it", ctx }),
    "DomainRuleError",
  ) && (await prisma.customer.count({ where: { email: customerEmail } })) === 0);
const realBatch = await commitImport({
  batchId: stagedBook.id,
  handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS,
  confirmPhrase: expectedCommitPhrase(stagedBook.validRows),
  ctx,
});
// committedRows for the customers handler counts what landed: the new
// customer plus each address added to the book (merge rows add nothing).
check("the real commit lands one customer + three addresses (three rows = one book)",
  realBatch.status === "COMMITTED" && realBatch.committedRows === 4);

const bookCustomer = await prisma.customer.findUniqueOrThrow({
  where: { email: customerEmail },
  include: { addresses: { orderBy: { createdAt: "asc" } } },
});
check("the book holds all three addresses (near-dupe kept for cleanup review)",
  bookCustomer.addresses.length === 3);
check("the unparseable ZIP landed flagged, not dropped",
  bookCustomer.addresses.some((address) => address.needsReview && address.reviewReason?.includes("call me") === true));

const stagedBookAgain = await stageImport({
  kind: "LEGACY_CUSTOMERS",
  handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS,
  filename: "legacy-customers-again.csv",
  csvText: customersCsv,
  ctx,
});
const reCommit = await commitImport({
  batchId: stagedBookAgain.id,
  handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS,
  confirmPhrase: expectedCommitPhrase(stagedBookAgain.validRows),
  ctx,
});
check("re-importing the same file merges — zero new customers, zero new addresses",
  reCommit.committedRows === 0 &&
    (await prisma.customer.count({ where: { email: customerEmail } })) === 1 &&
    (await prisma.address.count({ where: { customerId: bookCustomer.id } })) === 3);

// Ambiguity: email and phone pointing at DIFFERENT customers never guesses.
const ambA = await prisma.customer.create({ data: { email: `p12-amb-a-${stamp}@example.org`, name: "Amb A" } });
const ambPhoneRaw = uniqPhone(7);
const ambPhone = normalizePhone(ambPhoneRaw)!;
await prisma.customer.create({
  data: { email: `p12-amb-b-${stamp}@example.org`, name: "Amb B", phone: ambPhoneRaw, normalizedPhone: ambPhone },
});
const stagedAmb = await stageImport({
  kind: "LEGACY_CUSTOMERS",
  handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS,
  filename: "legacy-ambiguous.csv",
  csvText: [
    "customer_name,email,phone,line1,city,region,postal_code",
    `Split Person,${ambA.email},${ambPhoneRaw},1 Split Way,Lakewood,NJ,08701`,
  ].join("\n"),
  ctx,
});
const ambBatch = await commitImport({
  batchId: stagedAmb.id,
  handler: IMPORT_HANDLERS.LEGACY_CUSTOMERS,
  confirmPhrase: expectedCommitPhrase(stagedAmb.validRows),
  ctx,
});
const ambRow = readPayload(ambBatch).rows[0];
check("an email/phone split lands invalid with a human-merge reason",
  ambBatch.committedRows === 0 && ambRow.verdict === "invalid" && ambRow.reason?.includes("merge") === true);

// =============================================================================
// 2. Address-book cleanup (UR-014): scan, merge, resolve-review
// =============================================================================
const scan = await scanBook(bookCustomer.id);
check("the scanner groups the punctuation-drift pair",
  scan.duplicates.some((group) => group.addresses.length === 2));
check("the scanner reports the flagged ZIP row", scan.flagged.length === 1);

const dupeGroup = scan.duplicates.find((group) => group.addresses.length === 2)!;
const [keep, drop] = dupeGroup.addresses;
const merged = await mergeAddresses({ customerId: bookCustomer.id, keepId: keep.id, dropIds: [drop.id], ctx });
check("merge keeps one row and drops the other (audited)",
  merged.merged === 1 && (await prisma.address.count({ where: { customerId: bookCustomer.id } })) === 2);
// Cross-customer merge guard: an address on ambA can never be dropped
// against bookCustomer's keep.
const foreign = await prisma.address.create({
  data: { customerId: ambA.id, label: "foreign", line1: "2 Elsewhere", city: "Lakewood", region: "NJ", postalCode: "08701" },
});
check(
  "merge refuses to drop another customer's address",
  await throwsNamed(
    () => mergeAddresses({ customerId: bookCustomer.id, keepId: keep.id, dropIds: [foreign.id], ctx }),
    "DomainRuleError",
  ),
);
await prisma.address.delete({ where: { id: foreign.id } });

await resolveReview({ customerId: bookCustomer.id, addressId: scan.flagged[0].id, ctx });
const afterResolve = await scanBook(bookCustomer.id);
check("resolve-review clears the flag (audited) and keeps the address",
  afterResolve.flagged.length === 0 &&
    (await prisma.address.count({ where: { customerId: bookCustomer.id } })) === 2);

// =============================================================================
// 3. Legacy products + orders: seasons, stubs, order-number repair, payments
// =============================================================================
const productsCsv = [
  "year,product_name,price,product_type,size_text",
  "2023,Legacy Honey Cake,18.00,cake,9in",
  "2024,Shabbos Box,$47.85,box,large",
].join("\n");
const stagedProducts = await stageImport({
  kind: "LEGACY_PRODUCTS",
  handler: IMPORT_HANDLERS.LEGACY_PRODUCTS,
  filename: "legacy-products.csv",
  csvText: productsCsv,
  ctx,
});
const productBatch = await commitImport({
  batchId: stagedProducts.id,
  handler: IMPORT_HANDLERS.LEGACY_PRODUCTS,
  confirmPhrase: expectedCommitPhrase(stagedProducts.validRows),
  ctx,
});
// Rerunnable: deterministic slugs mean a second run marks both rows duplicate.
check("legacy products land (or, on rerun, dedupe) both rows",
  productBatch.committedRows! + productBatch.duplicateRows === 2);
const legacy2024 = await prisma.season.findFirstOrThrow({ where: { name: "Legacy 2024" } });
const shabbosBox = await prisma.product.findFirstOrThrow({ where: { slug: "legacy-2024-shabbos-box" } });
check("legacy seasons arrive CLOSED with the priced catalog rows (history, not a live catalog)",
  legacy2024.status === "CLOSED" &&
    (await prisma.season.findFirstOrThrow({ where: { name: "Legacy 2023" } })).status === "CLOSED" &&
    shabbosBox.basePriceCents === 4785);

const buyer1 = `p12-buyer1-${stamp}@example.org`;
const ordersCsv = [
  "legacy_order_no,order_date,email,customer_name,item_name,item_qty,item_unit_price,shipping_cents,payment_method,payment_status,recipient_name,recipient_line1,recipient_city,recipient_region,recipient_postal_code",
  `LG-P12-100-${stamp},2024-02-12,${buyer1},P12 Buyer,Shabbos Box,2,47.85,5.00,card,paid,,5 Test Way,Testville,NJ,08701`,
  `LG-P12-100-${stamp},2024-02-12,${buyer1},P12 Buyer,Unknown Relic,1,3.25,0,card,paid,,5 Test Way,Testville,NJ,08701`,
  `LG-P12-101-${stamp},2024-02-13,p12-buyer2-${stamp}@example.org,P12 Unpaid,Shabbos Box,1,47.85,0,cash,unpaid,,7 Test Way,Testville,NJ,08701`,
  `LG-P12-102-${stamp},2024-02-14,p12-buyer3-${stamp}@example.org,P12 Refunded,Shabbos Box,1,47.85,0,check,refunded,,9 Test Way,Testville,NJ,08701`,
].join("\n");
const stagedOrders = await stageImport({
  kind: "LEGACY_ORDERS",
  handler: IMPORT_HANDLERS.LEGACY_ORDERS,
  filename: "legacy-orders.csv",
  csvText: ordersCsv,
  ctx,
});
const orderBatch = await commitImport({
  batchId: stagedOrders.id,
  handler: IMPORT_HANDLERS.LEGACY_ORDERS,
  confirmPhrase: expectedCommitPhrase(stagedOrders.validRows),
  ctx,
});
check("the 4-row file commits as 3 orders", orderBatch.committedRows === 3);

const imported100 = await prisma.order.findFirstOrThrow({
  where: { legacyRef: `LG-P12-100-${stamp}` },
  include: { lines: true, payments: true, recipients: true },
});
check("order-number repair: clean sequential number + wire format, legacy ref preserved",
  typeof imported100.orderNumber === "number" &&
    typeof imported100.wireFormat === "string" &&
    imported100.legacyRef === `LG-P12-100-${stamp}`);
check("the two-line order totals reconcile against the source file (9570+325+500)",
  imported100.totalCents === 10395 && imported100.lines.length === 2);
check("the paid card order posts one STRIPE payment keyed legacy:<ref>",
  imported100.payments.length === 1 &&
    imported100.payments[0].status === "POSTED" &&
    imported100.payments[0].method === "STRIPE" &&
    imported100.payments[0].amountCents === 10395 &&
    imported100.payments[0].externalRef === `legacy:LG-P12-100-${stamp}`);
const stub = imported100.lines.find((line) => line.productName === "Unknown Relic");
check("the unknown product is stubbed inactive at $0 (review page is the correction UI)",
  stub !== undefined &&
    (await prisma.product.findUniqueOrThrow({ where: { id: stub.productId } })).active === false &&
    (await prisma.product.findUniqueOrThrow({ where: { id: stub.productId } })).basePriceCents === 0 &&
    stub.unitPriceCents === 325);

const imported101 = await prisma.order.findFirstOrThrow({ where: { legacyRef: `LG-P12-101-${stamp}` }, include: { payments: true } });
check("the unpaid order lands UNPAID with no payment rows",
  imported101.paymentStatus === "UNPAID" && imported101.payments.length === 0);
const imported102 = await prisma.order.findFirstOrThrow({ where: { legacyRef: `LG-P12-102-${stamp}` }, include: { payments: true } });
check("the refunded order stays PAID with no payment rows (never enters collection queues)",
  imported102.paymentStatus === "PAID" && imported102.payments.length === 0);

const stagedOrdersAgain = await stageImport({
  kind: "LEGACY_ORDERS",
  handler: IMPORT_HANDLERS.LEGACY_ORDERS,
  filename: "legacy-orders-again.csv",
  csvText: ordersCsv,
  ctx,
});
const orderReimport = await commitImport({
  batchId: stagedOrdersAgain.id,
  handler: IMPORT_HANDLERS.LEGACY_ORDERS,
  confirmPhrase: expectedCommitPhrase(stagedOrdersAgain.validRows),
  ctx,
});
check("re-importing legacy orders marks every row duplicate via Order.legacyRef",
  orderReimport.duplicateRows === 4 && orderReimport.committedRows === 0 &&
    (await prisma.order.count({ where: { legacyRef: { endsWith: stamp } } })) === 3);

// =============================================================================
// 4. Reports (R-091) scoped to the legacy season, before recon adds payments
// =============================================================================
const perf = await getSeasonPerformance([legacy2024.id]);
check("the season performance row reflects at least the imported orders + posted revenue",
  perf.length === 1 && perf[0].finalizedOrders >= 3 && perf[0].revenuePostedCents >= 10395 &&
    perf[0].avgOrderCents === Math.round(perf[0].revenuePostedCents / perf[0].finalizedOrders));
const allPerf = await getSeasonPerformance();
check("the multi-season table covers every season in one bounded pass",
  allPerf.length === (await prisma.season.count()) && allPerf.every((row) => Array.isArray(row.channelMix)));
// Method-drill regression: the channel union must come from the fee MAP keys
// (groupBy result arrays have numeric .keys() — a crash the smoke caught on
// the real page). A channel + package fixture makes the non-empty path real.
const drillMethod = await prisma.fulfillmentMethod.findFirstOrThrow({ where: { code: "DELIVERY" } });
await prisma.draftRecipient.updateMany({ where: { orderId: imported101.id }, data: { fulfillmentChoice: "PER_PACKAGE_DELIVERY" } });
const drillPackage = await prisma.package.create({
  data: { orderId: imported101.id, recipientName: "P12 Drill", fulfillmentMethodId: drillMethod.id, groupingKey: `p12-drill-${stamp}`, channel: "PER_PACKAGE_DELIVERY" },
});
// M2: the charged side of the drill-down lives on the SHIPPED row (same shape
// as the S1 smoke ledger). A voided label returns the margin — its charge
// must NOT count as "shipping charged", exactly like the margin rollup.
const drillShipMethod = await prisma.fulfillmentMethod.findFirstOrThrow({ where: { code: "SHIPPED" } });
const shippedPackage = await prisma.package.create({
  data: { orderId: imported100.id, recipientName: "P12 Drill Ship", fulfillmentMethodId: drillShipMethod.id, groupingKey: `p12-drill-ship-${stamp}`, channel: "SHIPPED" },
});
await prisma.shipment.create({ data: { packageId: shippedPackage.id, status: "PURCHASED", chargedCents: 500, costCents: 400, marginCents: 100 } });
await prisma.shipment.create({ data: { packageId: shippedPackage.id, status: "VOIDED", chargedCents: 700, costCents: 600, marginCents: 100 } });
const methodDrill = await getMethodDrilldown(legacy2024.id);
check("the method drill-down aggregates real channel strings (regression: fee map keys, not array indices)",
  methodDrill.length >= 1 &&
    methodDrill.every((row) => typeof row.channel === "string" && Number.isFinite(row.deliveryFeesCents) && Number.isFinite(row.shippedChargedCents)) &&
    methodDrill.some((row) => row.channel === "PER_PACKAGE_DELIVERY" && row.packages >= 1));
// Rerun-safe parity: the drill's SHIPPED charged must equal the season's
// PURCHASED-only ground truth while a nonzero VOIDED charge exists that any
// regression to counting VOIDED would inflate.
const purchasedTruth = await prisma.shipment.aggregate({
  where: { package: { order: { seasonId: legacy2024.id } }, status: "PURCHASED" },
  _sum: { chargedCents: true },
});
const voidedTruth = await prisma.shipment.aggregate({
  where: { package: { order: { seasonId: legacy2024.id } }, status: "VOIDED" },
  _sum: { chargedCents: true },
});
check("the drill-down counts PURCHASED-only shipping charged (M2 margin-rollup parity; VOIDED excluded)",
  (voidedTruth._sum.chargedCents ?? 0) > 0 &&
    methodDrill.find((row) => row.channel === "SHIPPED")?.shippedChargedCents === (purchasedTruth._sum.chargedCents ?? 0));
const legacy2023 = await prisma.season.findFirstOrThrow({ where: { name: "Legacy 2023" } });
const emptyDrill = await getMethodDrilldown(legacy2023.id);
check("a season with no channel data drills empty instead of throwing", Array.isArray(emptyDrill) && emptyDrill.length === 0);
const productDrill = await getProductDrilldown(legacy2024.id);
const drillBox = productDrill.find((row) => row.productName === "Shabbos Box");
check("the product drill-down totals imported units + revenue by snapshot name",
  drillBox !== undefined && drillBox.units >= 4 && drillBox.revenueCents >= 4 * 4785 &&
    productDrill.some((row) => row.productName === "Unknown Relic"));
const rollup = await getMarginRollup();
check("the margin rollup returns a money-shaped aggregate",
  typeof rollup.chargedCents === "number" && typeof rollup.costCents === "number" && typeof rollup.marginCents === "number" && Array.isArray(rollup.byCarrier));

// =============================================================================
// 5. Export datasets (R-092): every generator yields header-width rows
// =============================================================================
for (const dataset of EXPORT_DATASET_LIST) {
  const iterator = dataset.rows(dataset.seasonScoped ? { seasonId: legacy2024.id } : {});
  const first = await iterator.next();
  const widthOk = first.done || first.value.length === dataset.header.length;
  const again = first.done ? { done: true } : await iterator.next();
  const secondWidthOk = again.done || (again.value ?? []).length === dataset.header.length;
  check(`export dataset "${dataset.key}" streams header-width rows`, widthOk && secondWidthOk);
}

// =============================================================================
// 6. Stripe reconciliation (R-093) against the fixture double
// =============================================================================
// Point the fixture intents at the imported orders, then build the local
// mirrors/payments that produce one finding of every kind plus one match.
for (const intent of fixtureIntents) {
  if (intent.metadata.orderId === "LATE") intent.metadata.orderId = imported100.id;
}
const [order101, order102] = [imported101, imported102];
await prisma.stripePaymentIntent.create({ data: { orderId: imported100.id, intentId: PI("ok"), amountCents: 4200, status: "succeeded" } });
await prisma.payment.create({ data: { orderId: imported100.id, method: "STRIPE", amountCents: 4200, externalRef: PI("ok") } });
await prisma.stripePaymentIntent.create({ data: { orderId: order102.id, intentId: PI("drift"), amountCents: 4200, status: "requires_payment_method" } });
await prisma.stripePaymentIntent.create({ data: { orderId: order101.id, intentId: PI("amount"), amountCents: 4200, status: "succeeded" } });
await prisma.payment.create({ data: { orderId: order101.id, method: "STRIPE", amountCents: 4100, externalRef: PI("amount") } });
await prisma.stripePaymentIntent.create({ data: { orderId: order101.id, intentId: PI("nopay"), amountCents: 4200, status: "succeeded" } });
await prisma.stripePaymentIntent.create({ data: { orderId: imported100.id, intentId: PI("stale"), amountCents: 500, status: "succeeded" } });

const paymentsBefore = await prisma.payment.count();
const first = await runReconciliation({ ctx });
const mine = (run: { findings: { kind: string; intentId?: string | null }[] }) =>
  run.findings
    .filter((finding) => finding.intentId?.endsWith(stamp) ?? false)
    .map((finding) => `${finding.kind}:${finding.intentId}`)
    .sort();

check("the run closes OK in fixture mode with the right shape",
  first.run.status === "OK" && first.run.mode === "fixture" && first.run.checkedCount === 6 && first.run.matchedCount === 1);
const kinds = mine(first);
check("every finding kind fires exactly once on the crafted ledger",
  JSON.stringify(kinds) === JSON.stringify([
    `AMOUNT_MISMATCH:${PI("amount")}`,
    `MISSING_PAYMENT:${PI("nopay")}`,
    `ORPHANED_INTENT:${PI("orphan")}`,
    `STATUS_DRIFT:${PI("drift")}`,
    `STALE_MIRROR:${PI("stale")}`,
  ].sort()));
check("the foreign intent (no orderId) is skipped, not flagged",
  !first.findings.some((finding) => finding.intentId === PI("foreign")) && first.run.message?.includes("1 foreign intent(s) skipped") === true);

const second = await runReconciliation({ ctx });
check("a rerun over unchanged data reproduces the identical finding set",
  JSON.stringify(mine(second)) === JSON.stringify(kinds));
check("the matcher NEVER writes payments",
  (await prisma.payment.count()) === paymentsBefore);
check("each run is its own persisted row (run history is the audit trail)",
  second.run.id !== first.run.id &&
    (await prisma.reconciliationFinding.count({ where: { runId: second.run.id } })) ===
      (await prisma.reconciliationFinding.count({ where: { runId: first.run.id } })));

// =============================================================================
// 7. Test-env guard: this workspace defaults to the test class (console open)
// =============================================================================
check("APP_ENV defaults to the test class here", env.APP_ENV === "test");
let guardThrew = false;
try { requireTestEnv(); } catch { guardThrew = true; }
check("the test-ops guard passes in the test class (HTTP destructive ops live in S4 smoke)", !guardThrew);

fixtureServer.close();
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} P12 domain check(s) failed`);
  process.exit(1);
}
console.log("All P12 domain checks passed");
