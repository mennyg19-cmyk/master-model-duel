// DB integration: payment post/void engine (R-160). Payments only attach to
// FINALIZED orders; paymentStatus cache recomputes on every post/void.
// Requires embedded Postgres on 4106 (db:start).
import { PrismaClient } from "@prisma/client";
import { createDraftOrder } from "../lib/orders/create-draft";
import { discardOrder, finalizeOrder } from "../lib/orders/state-machine";
import { classifyPaymentStatus, postPayment, voidPayment } from "../lib/payments/post";
import { DomainRuleError, NotFoundError } from "../lib/errors";
import { closeAllOpenSeasons, expectThrow, reopenSeasons } from "./test-db-helpers.mts";

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

// classifyPaymentStatus (pure)
check("0 paid → UNPAID", classifyPaymentStatus(0, 1000) === "UNPAID");
check("paid < total → PARTIAL", classifyPaymentStatus(400, 1000) === "PARTIAL");
check("paid = total → PAID", classifyPaymentStatus(1000, 1000) === "PAID");
check("paid > total → OVERPAID", classifyPaymentStatus(1200, 1000) === "OVERPAID");

const previouslyOpen = await closeAllOpenSeasons(prisma);

const season = await prisma.season.create({ data: { name: `TEST-PAY-${Date.now()}`, status: "OPEN" } });
const customer = await prisma.customer.create({
  data: { email: `pay-${Date.now()}@example.org`, name: "Pay Customer" },
});
const product = await prisma.product.create({
  data: { slug: `pay-product-${Date.now()}`, name: "Pay Product", basePriceCents: 1000, seasonId: season.id },
});
const line = { productId: product.id, qty: 1 };

// Payments rejected on non-finalized orders
const draft = await createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [line] });
check(
  "postPayment on a DRAFT order throws DomainRuleError",
  await expectThrow(() => postPayment({ orderId: draft.id, method: "CASH", amountCents: 500 }), DomainRuleError),
);
const draftToDiscard = await createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [line] });
await discardOrder(draftToDiscard.id);
check(
  "postPayment on a DISCARDED order throws DomainRuleError",
  await expectThrow(
    () => postPayment({ orderId: draftToDiscard.id, method: "CASH", amountCents: 500 }),
    DomainRuleError,
  ),
);
check(
  "non-positive amount rejected",
  await expectThrow(() => postPayment({ orderId: draft.id, method: "CASH", amountCents: 0 }), DomainRuleError),
);

// Happy path: finalize, then post partial → PARTIAL, remainder → PAID
await finalizeOrder(draft.id);
const first = await postPayment({ orderId: draft.id, method: "CASH", amountCents: 400 });
check("payment row created POSTED", first.status === "POSTED");
let order = await prisma.order.findUniqueOrThrow({ where: { id: draft.id } });
check("partial payment → PARTIAL cache", order.paymentStatus === "PARTIAL");

await postPayment({ orderId: draft.id, method: "CHECK", amountCents: 600 });
order = await prisma.order.findUniqueOrThrow({ where: { id: draft.id } });
check("full payment → PAID cache", order.paymentStatus === "PAID");

const over = await postPayment({ orderId: draft.id, method: "STRIPE", amountCents: 200 });
order = await prisma.order.findUniqueOrThrow({ where: { id: draft.id } });
check("overpayment → OVERPAID cache", order.paymentStatus === "OVERPAID");

// Void recomputes the cache; double-void rejected
await voidPayment(over.id, "duplicate");
order = await prisma.order.findUniqueOrThrow({ where: { id: draft.id } });
check("void recomputes cache back to PAID", order.paymentStatus === "PAID");
const voided = await prisma.payment.findUniqueOrThrow({ where: { id: over.id } });
check("voided payment carries status + reason", voided.status === "VOIDED" && voided.voidReason === "duplicate");
check(
  "double-void throws DomainRuleError",
  await expectThrow(() => voidPayment(over.id), DomainRuleError),
);
check(
  "voidPayment on a missing payment throws NotFoundError",
  await expectThrow(() => voidPayment("no-such-payment"), NotFoundError),
);

// Cleanup
await prisma.payment.deleteMany({ where: { order: { seasonId: season.id } } });
await prisma.order.deleteMany({ where: { seasonId: season.id } });
await prisma.product.delete({ where: { id: product.id } });
await prisma.season.delete({ where: { id: season.id } });
await prisma.customer.delete({ where: { id: customer.id } });
await reopenSeasons(prisma, previouslyOpen);
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} payment check(s) failed`);
  process.exit(1);
}
console.log("All payment checks passed");
