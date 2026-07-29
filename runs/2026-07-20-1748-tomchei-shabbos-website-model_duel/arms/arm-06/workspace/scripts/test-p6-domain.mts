// Domain checks for P6: staged atomic CSV import (customers + products),
// bulk actions with deterministic conflicts, single-order repeat, POS counter
// checkout (cash/check with staff audit), the Stripe refund keyless seam,
// dashboard aggregates, and the 1k-order scale fixture (R-105/G-024).

import { PrismaClient } from "@prisma/client";
import { setSetting } from "../lib/settings";
import { saveDraft } from "../lib/orders/drafts";
import { submitCheckout } from "../lib/checkout/submit";
import { checkoutPosOrder } from "../lib/payments/pos";
import { refundStripePayment } from "../lib/payments/refund";
import { repeatOrder } from "../lib/orders/repeat";
import { runBulkOrderAction, BULK_ACTION_LIMIT } from "../lib/orders/bulk";
import { stageImport, commitImport, discardImport, readPayload } from "../lib/imports/engine";
import { customersImport } from "../lib/imports/customers";
import { productsImport } from "../lib/imports/products";
import { buildOrderWhere, parseOrderListParams } from "../lib/admin/order-list";
import { getDashboardData } from "../lib/admin/dashboard";
import { closeAllOpenSeasons, expectThrow, reopenSeasons } from "./test-db-helpers.mts";
import { DomainRuleError } from "../lib/errors";

const prisma = new PrismaClient();
let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

const previouslyOpen = await closeAllOpenSeasons(prisma);
const stamp = Date.now();

const season = await prisma.season.create({ data: { name: `TEST-P6-${stamp}`, status: "OPEN" } });
const staff = await prisma.staffUser.create({
  data: {
    email: `p6-staff-${stamp}@example.org`,
    name: "P6 Staff",
    role: "MANAGER",
    status: "ACTIVE",
    confirmedAt: new Date(),
  },
});
const ctx = { staff: { id: staff.id, email: staff.email }, impersonator: null };
const customer = await prisma.customer.create({
  data: {
    email: `p6-${stamp}@example.org`,
    name: "P6 Customer",
    phone: `732-555-${String(stamp).slice(-4)}`,
    normalizedPhone: `73255${String(stamp).slice(-6)}`,
  },
});
const product = await prisma.product.create({
  data: { slug: `p6-box-${stamp}`, name: "P6 Box", basePriceCents: 1000, seasonId: season.id },
});

await setSetting("delivery.fees", { bulkPerDestinationCents: 900, perPackagePerRecipientCents: 450 });
await setSetting("delivery.days", ["Purim Eve", "Purim Day"]);
await setSetting("shipping.deliveryZips", ["08701"]);

// --- customers import: stage → preview verdicts → atomic commit --------------------
const existingEmail = `p6-${stamp}@example.org`; // seeded above
const customersCsv = [
  "name,email,phone",
  `New One,new1-${stamp}@example.org,732-555-${String(stamp).slice(-4)}`, // stamp-unique: phone dedupes too
  `New Two,new2-${stamp}@example.org,`,
  `Dupe Person,${existingEmail},`,
  `Bad Email,not-an-email,`,
  `New One Again,new1-${stamp}@example.org,`,
].join("\r\n");

const customerBatch = await stageImport({
  kind: "CUSTOMERS",
  handler: customersImport,
  filename: "customers.csv",
  csvText: customersCsv,
  ctx,
});
const staged = readPayload(customerBatch);
check(
  "customers stage counts: 2 valid, 2 duplicate, 1 invalid",
  customerBatch.totalRows === 5 && customerBatch.validRows === 2
    && customerBatch.duplicateRows === 2 && customerBatch.invalidRows === 1,
);
check(
  "existing-email row is a database duplicate",
  staged.rows.some((row) => row.verdict === "duplicate" && row.reason?.includes("already exists")),
);
check(
  "in-file duplicate reports against the first row",
  staged.rows.some((row) => row.verdict === "duplicate" && row.reason?.includes("duplicates row 1")),
);
check(
  "stage wrote the audit row",
  (await prisma.auditLog.count({ where: { action: "import_stage", targetId: customerBatch.id } })) === 1,
);
check(
  "staging wrote NO customers",
  (await prisma.customer.count({ where: { email: { startsWith: `new1-${stamp}` } } })) === 0,
);

const committedCustomers = await commitImport({ batchId: customerBatch.id, handler: customersImport, ctx });
check(
  "customers commit lands exactly the valid rows",
  committedCustomers.status === "COMMITTED" && committedCustomers.committedRows === 2
    && (await prisma.customer.count({ where: { email: { in: [`new1-${stamp}@example.org`, `new2-${stamp}@example.org`] } } })) === 2,
);
check(
  "commit wrote the audit row",
  (await prisma.auditLog.count({ where: { action: "import_commit", targetId: customerBatch.id } })) === 1,
);
check(
  "re-commit is a domain refusal, never a double write",
  await expectThrow(() => commitImport({ batchId: customerBatch.id, handler: customersImport, ctx }), DomainRuleError),
);

// M5 regression: two rows with different emails but one normalized phone —
// the second must be flagged in the preview, never silently dropped at commit.
// The 556 prefix keeps these numbers disjoint from this file's 732-555-xxxx
// fixtures (the first block's phone ends in the stamp's last 4 digits, so a
// 555 M5 number collides whenever that digit sequence starts with 9).
const phoneTwinCsv = [
  "name,email,phone",
  `Phone One,phone1-${stamp}@example.org,732-556-${String(stamp).slice(-4)}`,
  `Phone Two,phone2-${stamp}@example.org,(732) 556-${String(stamp).slice(-4)}`,
].join("\n");
const phoneBatch = await stageImport({
  kind: "CUSTOMERS",
  handler: customersImport,
  filename: "phones.csv",
  csvText: phoneTwinCsv,
  ctx,
});
const phoneStaged = readPayload(phoneBatch);
check(
  "in-file phone duplicate flags the second row despite different emails",
  phoneBatch.validRows === 1 && phoneBatch.duplicateRows === 1
    && phoneStaged.rows.some(
      (row) => row.verdict === "duplicate" && row.reason === "phone duplicates row 1 in this file",
    ),
);
const committedPhones = await commitImport({ batchId: phoneBatch.id, handler: customersImport, ctx });
check(
  "phone-twin commit lands exactly the one valid row, counts stay truthful",
  committedPhones.committedRows === 1 && committedPhones.validRows === 1 && committedPhones.duplicateRows === 1
    && (await prisma.customer.count({ where: { email: { startsWith: `phone` , endsWith: `-${stamp}@example.org` } } })) === 1,
);

const discardBatch = await stageImport({
  kind: "CUSTOMERS",
  handler: customersImport,
  filename: "discard.csv",
  csvText: `name,email\nDiscard Me,discard-${stamp}@example.org`,
  ctx,
});
await discardImport({ batchId: discardBatch.id, ctx });
const discarded = await prisma.importBatch.findUniqueOrThrow({ where: { id: discardBatch.id } });
check(
  "discard flips status, writes no rows, audits",
  discarded.status === "DISCARDED"
    && (await prisma.customer.count({ where: { email: `discard-${stamp}@example.org` } })) === 0
    && (await prisma.auditLog.count({ where: { action: "import_discard", targetId: discardBatch.id } })) === 1,
);

// --- products import: slug dupes + season targeting --------------------------------
const productsCsv = [
  "name,price,description,category,active",
  `P6 Box ${stamp},12.00,Duplicate slug,,true`, // slugifies to the existing p6-box-<stamp>
  `Honey Jar ${stamp},8.25,,Jars,true`,
  `Grape Juice ${stamp},6,,,`,
  `Broken Price,1.234,,,`,
].join("\n");
const productBatch = await stageImport({
  kind: "PRODUCTS",
  handler: productsImport,
  filename: "products.csv",
  csvText: productsCsv,
  extraPayload: { seasonId: season.id },
  ctx,
});
check(
  "products stage: slug collision is a duplicate, dirty price invalid",
  productBatch.validRows === 2 && productBatch.duplicateRows === 1 && productBatch.invalidRows === 1,
);
const committedProducts = await commitImport({ batchId: productBatch.id, handler: productsImport, ctx });
const honeyJar = await prisma.product.findUnique({ where: { slug: `honey-jar-${stamp}` } });
check(
  "products commit lands valid rows in the staged season with derived slugs",
  committedProducts.committedRows === 2 && honeyJar?.seasonId === season.id && honeyJar?.basePriceCents === 825,
);

// --- repeat + bulk actions ----------------------------------------------------------
async function makeFinalizedOrder(orderNumber: number, lines: { productId: string; qty: number; name: string }[]) {
  const order = await prisma.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      status: "FINALIZED",
      orderNumber,
      wireFormat: `MM-TEST-${orderNumber}`,
      paymentStatus: "PAID",
      totalCents: lines.reduce((sum, line) => sum + line.qty * 1000, 0),
    },
  });
  for (const [index, line] of lines.entries()) {
    await prisma.orderLine.create({
      data: {
        orderId: order.id,
        productId: line.productId,
        productName: line.name,
        qty: line.qty,
        unitPriceCents: 1000,
        lineTotalCents: line.qty * 1000,
      },
    });
  }
  await prisma.draftRecipient.create({
    data: {
      orderId: order.id,
      name: "Bubby",
      line1: "9 Hilltop Rd",
      city: "Lakewood",
      region: "NJ",
      postalCode: "08701",
    },
  });
  return order;
}

const repeatSource = await makeFinalizedOrder(96001, [{ productId: product.id, qty: 2, name: "P6 Box" }]);
const repeated = await repeatOrder(repeatSource.id);
check("single repeat mints a fresh draft", repeated.draftRef.startsWith("D-") && repeated.skipped.length === 0);
const repeatedDraft = await prisma.order.findUniqueOrThrow({
  where: { draftRef: repeated.draftRef },
  include: { lines: true, recipients: true },
});
check(
  "repeated draft copies lines and recipients, book-unlinked",
  repeatedDraft.status === "DRAFT" && repeatedDraft.lines.length === 1 && repeatedDraft.recipients.length === 1,
);

// Discontinue the product: repeat now reports the skip and writes nothing.
await prisma.product.update({ where: { id: product.id }, data: { active: false } });
check(
  "repeat with a discontinued product refuses (nothing left to repeat)",
  await expectThrow(() => repeatOrder(repeatSource.id), DomainRuleError),
);
await prisma.product.update({ where: { id: product.id }, data: { active: true } });

const draftToDiscard = await saveDraft({
  seasonId: season.id,
  customerId: customer.id,
  lines: [{ id: `bd-${stamp}`, productId: product.id, qty: 1, recipientClientId: "r1" }],
  recipients: [
    { clientId: "r1", name: "Bubby", line1: "9 Hilltop Rd", city: "Lakewood", region: "NJ", postalCode: "08701" },
  ],
  allowBookWrites: false,
});

const bulkReport = await runBulkOrderAction({
  action: "repeat",
  orderIds: [repeatSource.id, repeatSource.id, draftToDiscard.id, "missing-id"],
  ctx,
});
check(
  "bulk repeat: first occurrence processed, duplicate + wrong-state + missing reported",
  bulkReport.counts.succeeded === 1 && bulkReport.counts.skipped === 3
    && bulkReport.results[1].reason?.includes("duplicate in batch")
    && bulkReport.results[2].reason?.includes("DRAFT")
    && bulkReport.results[3].reason === "not an order in the open season",
);
const bulkDiscard = await runBulkOrderAction({ action: "discard", orderIds: [draftToDiscard.id], ctx });
check(
  "bulk discard flips the draft",
  bulkDiscard.counts.succeeded === 1
    && (await prisma.order.findUniqueOrThrow({ where: { id: draftToDiscard.id } })).status === "DISCARDED",
);
check(
  "bulk discard audits each discarded order in the discard transaction",
  (await prisma.auditLog.count({
    where: { action: "order_discard", targetId: draftToDiscard.id, actorId: staff.id },
  })) === 1,
);
// Regression (S4c): a FINALIZED order in a discard batch is a skipped row,
// never a batch-killing throw — IllegalTransitionError is per-row conflict.
const bulkDiscardFinalized = await runBulkOrderAction({ action: "discard", orderIds: [repeatSource.id], ctx });
check(
  "bulk discard of a FINALIZED order skips deterministically",
  bulkDiscardFinalized.counts.skipped === 1
    && bulkDiscardFinalized.results[0].reason?.includes("FINALIZED") === true
    && (await prisma.order.findUniqueOrThrow({ where: { id: repeatSource.id } })).status === "FINALIZED"
    && (await prisma.auditLog.count({ where: { action: "order_discard", targetId: repeatSource.id } })) === 0,
);
// M1 regression: orders outside the open season are skipped, never acted on —
// the bulk verb scopes exactly like the order list.
const closedSeason = await prisma.season.create({ data: { name: `TEST-P6-OLD-${stamp}`, status: "CLOSED" } });
const closedOrder = await prisma.order.create({
  data: {
    seasonId: closedSeason.id,
    customerId: customer.id,
    status: "FINALIZED",
    orderNumber: 97001,
    wireFormat: "MM-OLD-97001",
    paymentStatus: "PAID",
    totalCents: 700,
  },
});
for (const action of ["repeat", "discard"] as const) {
  const outOfSeason = await runBulkOrderAction({ action, orderIds: [closedOrder.id], ctx });
  check(
    `bulk ${action} on a closed-season order skips with the season reason`,
    outOfSeason.counts.succeeded === 0 && outOfSeason.counts.skipped === 1
      && outOfSeason.results[0].reason === "not an order in the open season",
  );
}
check(
  "the closed-season order is untouched after both skips",
  (await prisma.order.findUniqueOrThrow({ where: { id: closedOrder.id } })).status === "FINALIZED",
);
check(
  "bulk action over the limit refuses",
  await expectThrow(
    () => runBulkOrderAction({ action: "discard", orderIds: Array.from({ length: BULK_ACTION_LIMIT + 1 }, (_, i) => `x${i}`), ctx }),
    DomainRuleError,
  ),
);

// --- POS checkout: cash with staff audit ---------------------------------------------
const posDraft = await saveDraft({
  seasonId: season.id,
  customerId: customer.id,
  lines: [{ id: `pos-${stamp}`, productId: product.id, qty: 2, recipientClientId: "r1" }],
  recipients: [
    { clientId: "r1", name: "Bubby", line1: "9 Hilltop Rd", city: "Lakewood", region: "NJ", postalCode: "08701" },
  ],
  allowBookWrites: false,
});
const posRecipient = posDraft.recipients[0];

check(
  "public submit with cash is still refused (R-127)",
  await expectThrow(
    () =>
      submitCheckout(
        {
          draftRef: posDraft.draftRef!,
          expectedTotalCents: 2000,
          method: "cash",
          recipients: [{ recipientId: posRecipient.id, fulfillmentChoice: "PICKUP" }],
        },
        { customerId: customer.id },
      ),
    (await import("../lib/checkout/submit")).OfflinePaymentForbiddenError,
  ),
);

const posOutcome = await checkoutPosOrder({
  checkout: {
    draftRef: posDraft.draftRef!,
    expectedTotalCents: 2000,
    method: "cash",
    recipients: [{ recipientId: posRecipient.id, fulfillmentChoice: "PICKUP" }],
  },
  ctx,
});
const posOrder = await prisma.order.findUniqueOrThrow({
  where: { id: posOutcome.orderId },
  include: { payments: true },
});
check(
  "POS checkout finalizes, posts cash, pays in full",
  posOrder.status === "FINALIZED" && posOrder.paymentStatus === "PAID"
    && posOrder.payments.length === 1 && posOrder.payments[0].method === "CASH"
    && posOrder.payments[0].postedById === staff.id,
);
check(
  "POS payment audit names the staff actor and pos channel",
  (await prisma.auditLog.count({
    where: {
      action: "payment_post",
      targetId: posOrder.payments[0].id,
      actorId: staff.id,
    },
  })) === 1,
);

// --- refund: the keyless seam refuses instead of faking a void ------------------------
const refundOrder = await prisma.order.create({
  data: {
    seasonId: season.id,
    customerId: customer.id,
    status: "FINALIZED",
    orderNumber: 96002,
    paymentStatus: "PAID",
    totalCents: 500,
  },
});
const stripePayment = await prisma.payment.create({
  data: {
    orderId: refundOrder.id,
    method: "STRIPE",
    amountCents: 500,
    externalRef: `pi_test_${stamp}`,
  },
});
// M3 regression: with no Stripe keys the refund must NOT void locally — the
// payment stays POSTED, the order stays PAID, and no payment_refund audit
// lands. VOIDED is evidence-gated to a real Stripe refund (API or webhook).
let refusalMessage = "";
try {
  await refundStripePayment({
    paymentId: stripePayment.id,
    reason: "customer changed their mind",
    actor: { id: staff.id, email: staff.email },
  });
} catch (error) {
  refusalMessage = (error as Error).message;
}
check(
  "keyless refund refuses with operator instructions",
  refusalMessage.includes("Stripe is not configured") && refusalMessage.includes("dashboard"),
);
const paymentAfterRefusal = await prisma.payment.findUniqueOrThrow({ where: { id: stripePayment.id } });
check(
  "refused refund changes nothing: payment POSTED, order PAID, no fake audit",
  paymentAfterRefusal.status === "POSTED" && paymentAfterRefusal.refundRef === null
    && (await prisma.order.findUniqueOrThrow({ where: { id: refundOrder.id } })).paymentStatus === "PAID"
    && (await prisma.auditLog.count({ where: { action: "payment_refund", targetId: stripePayment.id } })) === 0,
);
check(
  "cash payments never refund through Stripe",
  await expectThrow(
    () =>
      refundStripePayment({
        paymentId: posOrder.payments[0].id,
        actor: { id: staff.id, email: staff.email },
      }),
    DomainRuleError,
  ),
);

// --- dashboard -------------------------------------------------------------------------
// Collection-queue fixture: a finalized order with money still owed. The
// refused refund above leaves refundOrder PAID, so it must NOT appear here.
const owedOrder = await prisma.order.create({
  data: {
    seasonId: season.id,
    customerId: customer.id,
    status: "FINALIZED",
    orderNumber: 96003,
    paymentStatus: "UNPAID",
    totalCents: 750,
  },
});
const dashboard = await getDashboardData(season.id);
check(
  "dashboard counts finalized-today, revenue, and collection queue",
  dashboard.kpis.ordersToday >= 3 && dashboard.kpis.revenueTodayCents >= 2500
    && dashboard.kpis.awaitingCollection >= 1
    && dashboard.collectQueue.some((order) => order.id === owedOrder.id)
    && !dashboard.collectQueue.some((order) => order.id === refundOrder.id),
);
check("empty season dashboard is zeroed, not null", (await getDashboardData(null)).kpis.ordersToday === 0);

// --- scale fixture: 1k orders, bounded pages, numeric search -----------------------------
const scaleRows = Array.from({ length: 1000 }, (_, index) => ({
  seasonId: season.id,
  customerId: customer.id,
  status: "DRAFT" as const,
  draftRef: `S6-${stamp}-${index}`,
  totalCents: 1000 + (index % 50),
}));
await prisma.order.createMany({ data: scaleRows });

const scaleWhere = buildOrderWhere(season.id, parseOrderListParams({}));
const scaleCount = await prisma.order.count({ where: scaleWhere });
const scalePage = await prisma.order.findMany({
  where: scaleWhere,
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 25,
  skip: 25,
});
check(
  "1k-order season: count is exact, page 2 is a bounded 25-row slice",
  scaleCount >= 1000 && scalePage.length === 25,
);

const needle = await prisma.order.create({
  data: {
    seasonId: season.id,
    customerId: customer.id,
    status: "FINALIZED",
    orderNumber: 424242,
    wireFormat: "MM-TEST-424242",
    totalCents: 100,
  },
});
const searchWhere = buildOrderWhere(season.id, parseOrderListParams({ q: "424242" }));
const searchHits = await prisma.order.findMany({ where: searchWhere, take: 5 });
check(
  "numeric search over the 1k-row table hits the order number",
  searchHits.some((order) => order.id === needle.id),
);

// One-OPEN-per-season constraint: close ours before restoring the prior ones.
await prisma.season.update({ where: { id: season.id }, data: { status: "CLOSED" } });
await reopenSeasons(prisma, previouslyOpen);
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} P6 domain check(s) failed`);
  process.exit(1);
}
console.log("All P6 domain checks passed");
