// DB integration: the P5 checkout engine end to end — submit (choices, fees,
// greetings, conflicts, stock reserve), pay (Stripe-config seam), webhook
// handlers (complete/expire/refund via fabricated sessions), POS finalize,
// and reservation release on discard/edit. Requires embedded Postgres on
// 4106 (db:start). Stripe API calls never happen here: no STRIPE_SECRET_KEY
// in this process, so the safety-refund path records the audit row with a
// null refund id — the documented no-keys seam.
import { PrismaClient } from "@prisma/client";
import { setSetting } from "../lib/settings";
import { saveDraft } from "../lib/orders/drafts";
import { discardOrder } from "../lib/orders/state-machine";
import { generateGuestToken } from "../lib/orders/guest-token";
import { completeCheckoutSession, expireCheckoutSession, syncChargeRefunded } from "../lib/checkout/webhook";
import { finalizePosOrder, SessionInFlightError } from "../lib/checkout/pos";
import { payCheckout } from "../lib/checkout/pay";
import { submitCheckout } from "../lib/checkout/submit";
import { CheckoutConflictError } from "../lib/checkout/validate";
import { DomainRuleError, NotFoundError } from "../lib/errors";
import { StripeNotConfiguredError } from "../lib/payments/stripe";
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

const previouslyOpen = await closeAllOpenSeasons(prisma);
const stamp = Date.now();

const season = await prisma.season.create({ data: { name: `TEST-P5-${stamp}`, status: "OPEN" } });
const customer = await prisma.customer.create({
  data: { email: `p5-${stamp}@example.org`, name: "P5 Customer" },
});
const otherCustomer = await prisma.customer.create({
  data: { email: `p5-other-${stamp}@example.org`, name: "Other Customer" },
});
const tracked = await prisma.product.create({
  data: {
    slug: `p5-tracked-${stamp}`,
    name: "P5 Tracked",
    basePriceCents: 2000,
    seasonId: season.id,
    trackInventory: true,
  },
});
const trackedItem = await prisma.inventoryItem.create({ data: { productId: tracked.id, onHand: 10 } });
await prisma.product.create({
  data: { slug: `p5-untracked-${stamp}`, name: "P5 Untracked", basePriceCents: 500, seasonId: season.id },
});
// Second tracked product so the race/season probes below keep their own
// inventory numbers and never disturb the exact-count checks above.
const tracked2 = await prisma.product.create({
  data: {
    slug: `p5-tracked2-${stamp}`,
    name: "P5 Tracked Two",
    basePriceCents: 2000,
    seasonId: season.id,
    trackInventory: true,
  },
});
await prisma.inventoryItem.create({ data: { productId: tracked2.id, onHand: 10 } });

await setSetting("delivery.fees", { bulkPerDestinationCents: 900, perPackagePerRecipientCents: 450 });
await setSetting("delivery.days", ["Purim Eve", "Purim Day"]);
await setSetting("shipping.deliveryZips", ["08701"]);

const bookAddress = await prisma.address.create({
  data: {
    customerId: customer.id,
    label: "Bubby",
    line1: "9 Hilltop Rd",
    city: "Lakewood",
    region: "NJ",
    postalCode: "08701",
    country: "US",
  },
});

function makeRecipients() {
  return [
    {
      clientId: "r1",
      name: "Bubby",
      line1: "9 Hilltop Rd",
      city: "Lakewood",
      region: "NJ",
      postalCode: "08701",
      addressId: bookAddress.id,
    },
    {
      clientId: "r2",
      name: "Aunt Miriam",
      line1: "40 Faraway Ln",
      city: "Monsey",
      region: "NY",
      postalCode: "10952",
    },
  ] as const;
}

// Caller line ids become OrderLine row ids (parentLineId wiring), so every
// draft needs fresh ones.
let lineSeq = 0;
function makeLines() {
  lineSeq += 1;
  return [
    { id: `l1-${stamp}-${lineSeq}`, productId: tracked.id, qty: 2, recipientClientId: "r1" },
    { id: `l2-${stamp}-${lineSeq}`, productId: tracked.id, qty: 1, recipientClientId: "r2" },
  ];
}

async function makeDraft() {
  return saveDraft({
    seasonId: season.id,
    customerId: customer.id,
    lines: [...makeLines()],
    recipients: makeRecipients().map((recipient) => ({ ...recipient })),
    allowBookWrites: false,
  });
}

let line2Seq = 0;
async function makeTracked2Draft() {
  line2Seq += 1;
  return saveDraft({
    seasonId: season.id,
    customerId: customer.id,
    lines: [{ id: `lt-${stamp}-${line2Seq}`, productId: tracked2.id, qty: 2, recipientClientId: "r1" }],
    recipients: [{ ...makeRecipients()[0], addressId: null }],
    allowBookWrites: false,
  });
}

// 2×2000 pickup for the tracked2 drafts (no delivery fee).
const TRACKED2_TOTAL = 4000;
async function submitTracked2(draftRef: string, recipientId: string) {
  return submitCheckout(
    {
      draftRef,
      method: "card",
      greetingDefault: null,
      expectedTotalCents: TRACKED2_TOTAL,
      recipients: [{ recipientId, fulfillmentChoice: "PICKUP" }],
    },
    access,
  );
}

// Include order is not guaranteed, so address recipients by name.
function recipientIds(draft: { recipients: { id: string; name: string }[] }) {
  const r1 = draft.recipients.find((recipient) => recipient.name === "Bubby")!.id;
  const r2 = draft.recipients.find((recipient) => recipient.name === "Aunt Miriam")!.id;
  return { r1, r2 };
}

const access = { customerId: customer.id };
// lines: 2×2000 + 1×2000 = 6000; fees: r1 per-package 450 + r2 bulk 900 = 1350.
const EXPECTED_SUBTOTAL = 6000;
const EXPECTED_FEES = 1350;
const EXPECTED_TOTAL = EXPECTED_SUBTOTAL + EXPECTED_FEES;

function submitBody(draftRef: string, recipientIds: { r1: string; r2: string }, overrides: Record<string, unknown> = {}) {
  return {
    draftRef,
    method: "card" as const,
    greetingDefault: "Happy Purim!",
    expectedTotalCents: EXPECTED_TOTAL,
    recipients: [
      { recipientId: recipientIds.r1, fulfillmentChoice: "PER_PACKAGE_DELIVERY" as const, deliveryDay: "Purim Day" },
      { recipientId: recipientIds.r2, fulfillmentChoice: "BULK_DELIVERY" as const, greeting: "  For Miriam  " },
    ],
    ...overrides,
  };
}

// --- submit: happy path ---------------------------------------------------------
const draft = await makeDraft();
const { r1, r2 } = recipientIds(draft);
const summary = await submitCheckout(submitBody(draft.draftRef!, { r1: r1, r2: r2 }), access);
check("submit returns a summary", summary !== null);
check("summary subtotal/fee/total are the fresh server numbers",
  summary!.subtotalCents === EXPECTED_SUBTOTAL && summary!.deliveryFeesCents === EXPECTED_FEES && summary!.totalCents === EXPECTED_TOTAL);
check("stripe is reported unconfigured without keys", summary!.stripeConfigured === false);
const afterSubmit = await prisma.order.findUniqueOrThrow({ where: { id: draft.id }, include: { recipients: true } });
check("submit freezes fees + greeting default on the order",
  afterSubmit.deliveryFeesCents === EXPECTED_FEES && afterSubmit.greetingDefault === "Happy Purim!");
check("submit marks stock reserved", afterSubmit.stockReserved === true);
const itemAfterSubmit = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: trackedItem.id } });
check("reservation increments reserved (onHand untouched)", itemAfterSubmit.reserved === 3 && itemAfterSubmit.onHand === 10);
const submittedR1 = afterSubmit.recipients.find((recipient) => recipient.id === r1)!;
const submittedR2 = afterSubmit.recipients.find((recipient) => recipient.id === r2)!;
check("recipient choices + fee snapshots persist",
  submittedR1.fulfillmentChoice === "PER_PACKAGE_DELIVERY" && submittedR1.deliveryDay === "Purim Day"
  && submittedR1.deliveryFeeCents === 450 && submittedR2.deliveryFeeCents === 900);
check("recipient greeting normalizes", submittedR2.greeting === "For Miriam");
check("per-package fee only inside allowlist is on r1 (08701), bulk on r2 (10952)",
  summary!.recipients.find((r) => r.recipientId === r1)!.deliveryFeeCents === 450);

// --- submit: conflicts and refusals ---------------------------------------------
const stale = await makeDraft();
const { r1: sr1, r2: sr2 } = recipientIds(stale);
check(
  "stale expectedTotalCents is a CheckoutConflictError with fresh totals",
  await expectThrow(
    () => submitCheckout(submitBody(stale.draftRef!, { r1: sr1, r2: sr2 }, { expectedTotalCents: 1 }), access),
    CheckoutConflictError,
  ),
);
try {
  await submitCheckout(submitBody(stale.draftRef!, { r1: sr1, r2: sr2 }, { expectedTotalCents: 1 }), access);
  check("conflict report reaches the caller", false);
} catch (error) {
  const report = (error as CheckoutConflictError).report;
  check("conflict report reaches the caller",
    report.freshTotalCents === EXPECTED_TOTAL && report.expectedTotalCents === 1
    && report.priceConflicts.length === 0 && report.stockIssues.length === 0);
}

// Price drift after the draft was saved → conflict naming the product.
const drift = await makeDraft();
const { r1: dr1, r2: dr2 } = recipientIds(drift);
await prisma.product.update({ where: { id: tracked.id }, data: { basePriceCents: 2500 } });
try {
  await submitCheckout(submitBody(drift.draftRef!, { r1: dr1, r2: dr2 }), access);
  check("price drift is a conflict", false);
} catch (error) {
  const report = (error as CheckoutConflictError).report;
  check("price drift is a conflict naming the product and the fresh total",
    report.priceConflicts.some((conflict) => conflict.productName === "P5 Tracked" && conflict.freshCents === 5000)
    && report.freshSubtotalCents === 7500);
}
await prisma.product.update({ where: { id: tracked.id }, data: { basePriceCents: 2000 } });

const zipBlocked = await makeDraft();
const { r1: zr1, r2: zr2 } = recipientIds(zipBlocked);
check(
  "per-package outside the allowlist is refused",
  await expectThrow(
    () => submitCheckout(submitBody(zipBlocked.draftRef!, { r1: zr1, r2: zr2 }, {
      recipients: [
        { recipientId: zr2, fulfillmentChoice: "PER_PACKAGE_DELIVERY", deliveryDay: "Purim Day" },
        { recipientId: zr1, fulfillmentChoice: "PER_PACKAGE_DELIVERY", deliveryDay: "Purim Day" },
      ],
    }), access),
    DomainRuleError,
  ),
);
check(
  "per-package without a listed day is refused",
  await expectThrow(
    () => submitCheckout(submitBody(zipBlocked.draftRef!, { r1: zr1, r2: zr2 }, {
      recipients: [
        { recipientId: zr1, fulfillmentChoice: "PER_PACKAGE_DELIVERY", deliveryDay: "Shabbos" },
        { recipientId: zr2, fulfillmentChoice: "BULK_DELIVERY" },
      ],
    }), access),
    DomainRuleError,
  ),
);
try {
  await submitCheckout(submitBody(zipBlocked.draftRef!, { r1: zr1, r2: zr2 }, { method: "cash" }), access);
  check("offline method on the public path is refused", false);
} catch (error) {
  check(
    "offline method on the public path is refused",
    (error as Error).name === "OfflinePaymentForbiddenError",
  );
}
check(
  "another customer's draft is invisible (anti-enumeration)",
  (await submitCheckout(submitBody(zipBlocked.draftRef!, { r1: zr1, r2: zr2 }), { customerId: otherCustomer.id })) === null,
);
let partialDraftId: string | null = null;
check(
  "unassigned lines refuse checkout",
  await expectThrow(async () => {
    const partial = await saveDraft({
      seasonId: season.id,
      customerId: customer.id,
      lines: [{ id: `lu-${stamp}`, productId: tracked.id, qty: 1 }],
      recipients: [],
      allowBookWrites: false,
    });
    partialDraftId = partial.id;
    return submitCheckout(
      { draftRef: partial.draftRef!, method: "card", expectedTotalCents: 2000, recipients: [] },
      access,
    );
  }, DomainRuleError),
);

// Guest draft ownership: right token submits, wrong token is a flat null.
const guestToken = generateGuestToken();
const guestDraft = await saveDraft({
  seasonId: season.id,
  customerId: customer.id,
  lines: [{ id: `lg-${stamp}`, productId: tracked.id, qty: 1, recipientClientId: "r1" }],
  recipients: [{ ...makeRecipients()[0], addressId: null }],
  guestToken,
  allowBookWrites: false,
});
check(
  "guest draft refuses a wrong token (anti-enumeration)",
  (await submitCheckout(
    { draftRef: guestDraft.draftRef!, method: "card", expectedTotalCents: 2450, recipients: [{ recipientId: guestDraft.recipients[0].id, fulfillmentChoice: "PICKUP" }] },
    { guestToken: generateGuestToken() },
  )) === null,
);
check(
  "guest draft submits with the right token",
  (await submitCheckout(
    { draftRef: guestDraft.draftRef!, method: "card", expectedTotalCents: 2000, recipients: [{ recipientId: guestDraft.recipients[0].id, fulfillmentChoice: "PICKUP" }] },
    { guestToken },
  )) !== null,
);
// Its reservation is proven; release it so later stock assertions stay exact.
await discardOrder(guestDraft.id);

// --- pay: the Stripe seam ----------------------------------------------------------
check(
  "pay before submit is refused",
  await expectThrow(async () => {
    const fresh = await makeDraft();
    return payCheckout(fresh.draftRef!, access, "http://localhost:3106");
  }, DomainRuleError),
);
check(
  "pay without Stripe keys raises the documented seam error",
  await expectThrow(() => payCheckout(draft.draftRef!, access, "http://localhost:3106"), StripeNotConfiguredError),
);

// --- webhook complete: happy path ---------------------------------------------------
const paid = await prisma.order.findUniqueOrThrow({ where: { id: draft.id } });
const session = {
  id: `cs_test_${stamp}`,
  amount_total: EXPECTED_TOTAL,
  payment_intent: `pi_${stamp}`,
  client_reference_id: paid.draftRef,
  metadata: { orderId: paid.id },
};
const completed = await completeCheckoutSession(session);
check("webhook complete finalizes the order", completed.outcome === "finalized" && typeof completed.orderNumber === "number");
const finalizedOrder = await prisma.order.findUniqueOrThrow({ where: { id: draft.id }, include: { payments: true } });
check("order is FINALIZED with a number and PAID cache",
  finalizedOrder.status === "FINALIZED" && finalizedOrder.orderNumber !== null && finalizedOrder.paymentStatus === "PAID");
check("stripe payment posted with the intent as externalRef",
  finalizedOrder.payments.length === 1 && finalizedOrder.payments[0].method === "STRIPE"
  && finalizedOrder.payments[0].status === "POSTED" && finalizedOrder.payments[0].externalRef === `pi_${stamp}`
  && finalizedOrder.payments[0].amountCents === EXPECTED_TOTAL);
const itemAfterFinalize = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: trackedItem.id } });
check("finalize commits stock (onHand −3, reservation released)",
  itemAfterFinalize.onHand === 7 && itemAfterFinalize.reserved === 0);
check("stockReserved flag clears on finalize", finalizedOrder.stockReserved === false);
const intentRow = await prisma.stripePaymentIntent.findUnique({ where: { intentId: `pi_${stamp}` } });
check("payment-intent mirror row stored (no card fields)", intentRow !== null && intentRow.status === "succeeded");
const remembered = await prisma.address.findUniqueOrThrow({ where: { id: bookAddress.id } });
check("greeting remembered on the book address (G-020)", remembered.lastGreeting === "Happy Purim!");

check(
  "replayed complete is a duplicate, not a second payment",
  (await completeCheckoutSession(session)).outcome === "duplicate"
  && (await prisma.payment.count({ where: { orderId: draft.id } })) === 1,
);
check(
  "unknown session order is ignored",
  (await completeCheckoutSession({ id: "cs_unknown", amount_total: 0, payment_intent: null, client_reference_id: "MM-9999-XXXX" })).outcome === "ignored",
);

// --- refund sync -----------------------------------------------------------------------
const refundSync = await syncChargeRefunded({ id: "ch_1", payment_intent: `pi_${stamp}` });
check("refund sync voids the posted payment", refundSync.voided === true);
const afterRefund = await prisma.order.findUniqueOrThrow({ where: { id: draft.id }, include: { payments: true } });
check("payment cache recomputes to UNPAID after the void",
  afterRefund.paymentStatus === "UNPAID" && afterRefund.payments[0].status === "VOIDED");
check("refund sync for an unknown intent is a no-op",
  (await syncChargeRefunded({ id: "ch_2", payment_intent: "pi_nope" })).voided === false);

// --- safety refund: charged amount ≠ order total ------------------------------------------
const mismatched = await makeDraft();
const { r1: mr1, r2: mr2 } = recipientIds(mismatched);
await submitCheckout(submitBody(mismatched.draftRef!, { r1: mr1, r2: mr2 }), access);
const mismatchOutcome = await completeCheckoutSession({
  id: `cs_bad_${stamp}`,
  amount_total: EXPECTED_TOTAL + 1,
  payment_intent: `pi_bad_${stamp}`,
  client_reference_id: mismatched.draftRef,
  metadata: { orderId: mismatched.id },
});
check("charged-amount mismatch is a safety refund", mismatchOutcome.outcome === "safety_refund");
const mismatchedAfter = await prisma.order.findUniqueOrThrow({ where: { id: mismatched.id }, include: { payments: true } });
check("safety refund leaves the order DRAFT with no payment",
  mismatchedAfter.status === "DRAFT" && mismatchedAfter.payments.length === 0);
const itemAfterMismatch = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: trackedItem.id } });
check("safety refund releases the reservation", itemAfterMismatch.reserved === 0 && mismatchedAfter.stockReserved === false);
const refundAudit = await prisma.auditLog.findFirst({
  where: { action: "payment_auto_refund", targetId: mismatched.id },
});
check("safety refund writes the audit row", refundAudit !== null);

// --- expire session -------------------------------------------------------------------------
const expiring = await makeDraft();
const { r1: er1, r2: er2 } = recipientIds(expiring);
await submitCheckout(submitBody(expiring.draftRef!, { r1: er1, r2: er2 }), access);
const expired = await expireCheckoutSession({
  id: `cs_exp_${stamp}`,
  amount_total: null,
  payment_intent: null,
  client_reference_id: expiring.draftRef,
  metadata: { orderId: expiring.id },
});
check("expire releases the reservation", expired === true);
const expiringAfter = await prisma.order.findUniqueOrThrow({ where: { id: expiring.id } });
check("expired draft stays DRAFT and payable again",
  expiringAfter.status === "DRAFT" && expiringAfter.stockReserved === false && expiringAfter.stripeSessionId === null);

// --- POS finalize -----------------------------------------------------------------------------
const pos = await makeDraft();
const { r1: pr1, r2: pr2 } = recipientIds(pos);
check(
  "POS finalize before submit is refused",
  await expectThrow(() => finalizePosOrder(pos.id), DomainRuleError),
);
await submitCheckout(submitBody(pos.draftRef!, { r1: pr1, r2: pr2 }), access);
const posFinalized = await finalizePosOrder(pos.id);
check("POS finalize moves DRAFT → FINALIZED with a number", posFinalized.status === "FINALIZED" && posFinalized.orderNumber !== null);
const itemAfterPos = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: trackedItem.id } });
check("POS finalize commits the reservation", itemAfterPos.onHand === 4 && itemAfterPos.reserved === 0);
check(
  "POS finalize is final (a second attempt throws)",
  await expectThrow(() => finalizePosOrder(pos.id), DomainRuleError),
);

// --- POS/Stripe race: the stripeSessionId gate + the duplicate-path refund ------------------------
const raced = await makeTracked2Draft();
const racedRid = raced.recipients[0].id;
check("race probe draft submits", (await submitTracked2(raced.draftRef!, racedRid)) !== null);
await prisma.order.update({ where: { id: raced.id }, data: { stripeSessionId: `cs_inflight_${stamp}` } });
check(
  "POS finalize with a Stripe session in flight is refused (409-mapped error)",
  await expectThrow(() => finalizePosOrder(raced.id), SessionInFlightError),
);
await prisma.order.update({ where: { id: raced.id }, data: { stripeSessionId: null } });
const racedFinalized = await finalizePosOrder(raced.id);
check("POS finalize proceeds once the in-flight session is gone", racedFinalized.status === "FINALIZED");
const lateOnPos = await completeCheckoutSession({
  id: `cs_pos_late_${stamp}`,
  amount_total: TRACKED2_TOTAL,
  payment_intent: `pi_pos_late_${stamp}`,
  client_reference_id: raced.draftRef,
  metadata: { orderId: raced.id },
});
check("a different session paying after a POS finalize is a safety refund", lateOnPos.outcome === "safety_refund");
const racedAfter = await prisma.order.findUniqueOrThrow({ where: { id: raced.id }, include: { payments: true } });
check(
  "the POS-finalized order keeps zero card payments (no double payment)",
  racedAfter.status === "FINALIZED" && racedAfter.payments.length === 0,
);
check(
  "the raced payment lands on the audit trail",
  (await prisma.auditLog.count({ where: { action: "payment_auto_refund", targetId: raced.id } })) === 1,
);
check(
  "a session that never posted on a finalized order refunds again (Stripe-side idempotent refund key)",
  (
    await completeCheckoutSession({
      id: `cs_pos_late_${stamp}`,
      amount_total: TRACKED2_TOTAL,
      payment_intent: `pi_pos_late_${stamp}`,
      client_reference_id: raced.draftRef,
      metadata: { orderId: raced.id },
    })
  ).outcome === "safety_refund",
);
check(
  "the original session replaying against its own posted payment is a duplicate",
  (
    await completeCheckoutSession({
      id: `cs_test_${stamp}`,
      amount_total: EXPECTED_TOTAL,
      payment_intent: `pi_${stamp}`,
      client_reference_id: draft.draftRef,
      metadata: { orderId: draft.id },
    })
  ).outcome === "duplicate",
);

// --- season closes between submit and payment (webhook + pay gates) --------------------------------
const seasonRaced = await makeTracked2Draft();
check("season probe drafts submit", (await submitTracked2(seasonRaced.draftRef!, seasonRaced.recipients[0].id)) !== null);
const seasonPayProbe = await makeTracked2Draft();
check("season pay probe draft submits", (await submitTracked2(seasonPayProbe.draftRef!, seasonPayProbe.recipients[0].id)) !== null);
await prisma.season.update({ where: { id: season.id }, data: { status: "CLOSED" } });
check(
  "pay with a closed season raises the same gate as submit",
  await expectThrow(() => payCheckout(seasonPayProbe.draftRef!, access, "http://localhost:3106"), DomainRuleError),
);
const closedOutcome = await completeCheckoutSession({
  id: `cs_closed_${stamp}`,
  amount_total: TRACKED2_TOTAL,
  payment_intent: `pi_closed_${stamp}`,
  client_reference_id: seasonRaced.draftRef,
  metadata: { orderId: seasonRaced.id },
});
check("payment landing after the season closed is a safety refund, not a 500 loop", closedOutcome.outcome === "safety_refund");
const seasonRacedAfter = await prisma.order.findUniqueOrThrow({ where: { id: seasonRaced.id }, include: { payments: true } });
check(
  "the closed-season order stays DRAFT with no payment and its reservation released",
  seasonRacedAfter.status === "DRAFT" && seasonRacedAfter.payments.length === 0 && seasonRacedAfter.stockReserved === false,
);
check(
  "the closed-season refund lands on the audit trail",
  (await prisma.auditLog.count({ where: { action: "payment_auto_refund", targetId: seasonRaced.id } })) === 1,
);
await prisma.season.update({ where: { id: season.id }, data: { status: "OPEN" } });
await discardOrder(seasonPayProbe.id);

// --- fulfillment choice enum enforcement at the database level --------------------------------------
const enumProbe = await makeTracked2Draft();
const badChoice = await prisma
  .$executeRaw`UPDATE draft_recipients SET "fulfillmentChoice" = 'FOO' WHERE "orderId" = ${enumProbe.id}`
  .then(() => false)
  .catch(() => true);
check("the database refuses a fulfillment choice outside the enum", badChoice);

// --- reservation release on discard + draft edit -------------------------------------------------
const discarding = await makeDraft();
const { r1: dr11, r2: dr12 } = recipientIds(discarding);
await submitCheckout(submitBody(discarding.draftRef!, { r1: dr11, r2: dr12 }), access);
await discardOrder(discarding.id);
const itemAfterDiscard = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: trackedItem.id } });
check("discard releases the reservation", itemAfterDiscard.reserved === 0);
const discardedAfter = await prisma.order.findUniqueOrThrow({ where: { id: discarding.id } });
check("discarded order clears the reserved flag", discardedAfter.stockReserved === false);
check(
  "paid-for-discarded session is a safety refund, never a finalize",
  (await completeCheckoutSession({
    id: `cs_late_${stamp}`,
    amount_total: EXPECTED_TOTAL,
    payment_intent: `pi_late_${stamp}`,
    client_reference_id: discardedAfter.draftRef,
    metadata: { orderId: discarding.id },
  })).outcome === "safety_refund",
);

const edited = await makeDraft();
const { r1: ed1, r2: ed2 } = recipientIds(edited);
await submitCheckout(submitBody(edited.draftRef!, { r1: ed1, r2: ed2 }), access);
await saveDraft({
  seasonId: season.id,
  customerId: customer.id,
  draftOrderId: edited.id,
  lines: [...makeLines()],
  recipients: makeRecipients().map((recipient) => ({ ...recipient })),
  allowBookWrites: false,
});
const editedAfter = await prisma.order.findUniqueOrThrow({ where: { id: edited.id } });
check("editing a submitted draft releases stock + resets checkout state",
  editedAfter.stockReserved === false && editedAfter.deliveryFeesCents === 0 && editedAfter.greetingDefault === null);

// --- cleanup --------------------------------------------------------------------------------------
// Season-scoped: drafts created inside refusal probes never reach a named
// variable, so anything on the test season goes.
const seasonOrders = await prisma.order.findMany({ where: { seasonId: season.id }, select: { id: true } });
const seasonOrderIds = seasonOrders.map((order) => order.id);
const seasonPayments = await prisma.payment.findMany({ where: { orderId: { in: seasonOrderIds } }, select: { id: true } });
await prisma.auditLog.deleteMany({
  where: { targetId: { in: [...seasonOrderIds, ...seasonPayments.map((payment) => payment.id)] } },
});
await prisma.stripePaymentIntent.deleteMany({ where: { orderId: { in: seasonOrderIds } } });
await prisma.payment.deleteMany({ where: { orderId: { in: seasonOrderIds } } });
await prisma.orderLine.deleteMany({ where: { orderId: { in: seasonOrderIds } } });
await prisma.draftRecipient.deleteMany({ where: { orderId: { in: seasonOrderIds } } });
await prisma.order.deleteMany({ where: { seasonId: season.id } });
await prisma.address.delete({ where: { id: bookAddress.id } });
// Slug-pattern sweep (not just this run's two items): an interrupted earlier
// run leaves p5-* products behind, and deleting a product whose inventory row
// survives trips the XOR check on the nulled productId. Smoke fixtures in the
// seeded season (S2A3-style lines) pin p5-* products too — drop those lines
// (children before parents, RESTRICT) before the product sweep.
await prisma.inventoryItem.deleteMany({ where: { product: { slug: { contains: "p5-" } } } });
await prisma.orderLine.deleteMany({ where: { parentLine: { product: { slug: { contains: "p5-" } } } } });
await prisma.orderLine.deleteMany({ where: { product: { slug: { contains: "p5-" } } } });
await prisma.product.deleteMany({ where: { slug: { contains: `p5-` } } });
await prisma.customer.deleteMany({ where: { id: { in: [customer.id, otherCustomer.id] } } });
await prisma.season.delete({ where: { id: season.id } });
await reopenSeasons(prisma, previouslyOpen);
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} checkout check(s) failed`);
  process.exit(1);
}
console.log("All checkout checks passed");
