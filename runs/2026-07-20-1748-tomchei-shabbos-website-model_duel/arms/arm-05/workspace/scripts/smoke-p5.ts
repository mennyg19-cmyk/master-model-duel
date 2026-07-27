import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { POST as postOfflinePayment } from "../app/api/admin/orders/[orderId]/offline-payment/route";
import { POST as stripeWebhook } from "../app/api/stripe/webhook/route";
import { completeCheckout, createPosOrder, startCheckout, voidOfflinePayment } from "../lib/checkout";
import { createDevSessionToken } from "../lib/dev-auth";
import { discardOrder, assertOrderTransition } from "../lib/orders";
import { createDraft, readDraft, saveDraft } from "../lib/order-builder";
import { LOCAL_DATABASE_URL, runWithLocalDatabase } from "./local-db";

function customerRequest() {
  const token = createDevSessionToken({ userId: "customer-seed", email: "seed@example.test", expiresAt: Date.now() + 60_000 });
  return new Request("http://localhost:3105/api/order/drafts", { headers: { "x-dev-session": token } });
}

function staffRequest() {
  const token = createDevSessionToken({ userId: "staff-p5-smoke", email: "staff-p5@example.test", expiresAt: Date.now() + 60_000 });
  return new Request("http://localhost:3105/api/admin/orders", { headers: { "x-dev-session": token } });
}

async function draftWithRecipients(productId: string, recipients: { recipientName: string; line1: string; postalCode: string }[]) {
  const request = customerRequest();
  const { draft } = await createDraft(request);
  await saveDraft(request, draft.id, {
    lines: recipients.map((recipient) => ({
      productId,
      quantity: 1,
      addOns: [],
      recipient: { kind: "new" as const, city: "Brooklyn", state: "NY", ...recipient },
    })),
  });
  return readDraft(request, draft.id);
}

function checkoutInput(draft: NonNullable<Awaited<ReturnType<typeof readDraft>>>, method: "LOCAL_DELIVERY" | "BULK_DELIVERY" = "LOCAL_DELIVERY") {
  const addressIds = new Set(
    ((draft.wireFormat as { lines?: { recipient?: { addressId?: string } }[] }).lines ?? [])
      .map((line) => line.recipient?.addressId)
      .filter((addressId): addressId is string => Boolean(addressId)),
  );
  return {
    donationCents: 0,
    recipients: draft.customer!.addresses.filter((address) => addressIds.has(address.id)).map((address) => ({
      addressId: address.id,
      method,
      greeting: `Happy Purim, ${address.recipientName}!`,
      deliveryDate: "2026-03-02",
    })),
  };
}

async function verifySmoke() {
  Object.assign(process.env, {
    NODE_ENV: "development",
    DEV_AUTH_MODE: "true",
    DEV_AUTH_SECRET: "p5-smoke-secret",
    STRIPE_WEBHOOK_SECRET: "p5-webhook-secret",
  });
  delete process.env.STRIPE_SECRET_KEY;
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const product = await prisma.product.findFirstOrThrow({
      where: { season: { year: 2026 }, sku: "PURIM-BOX-01" },
      include: { inventoryItems: true },
    });
    const multiRecipient = await draftWithRecipients(product.id, [
      { recipientName: "Ada One", line1: "11 First Street", postalCode: "11201" },
      { recipientName: "Bea Two", line1: "12 Second Street", postalCode: "11205" },
    ]);
    assert.ok(multiRecipient);
    const checkout = await startCheckout(multiRecipient.id, checkoutInput(multiRecipient), "http://localhost:3105/api/checkout");
    assert.equal(checkout.local, true);
    const event = { id: `evt_p5_web_${checkout.sessionId}`, type: "checkout.session.completed", data: { object: { id: checkout.sessionId } } };
    const body = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.${body}`).digest("hex");
    const response = await stripeWebhook(new Request("http://localhost:3105/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      body,
    }));
    assert.equal(response.status, 200);
    const replay = await stripeWebhook(new Request("http://localhost:3105/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      body,
    }));
    assert.equal((await replay.json() as { replayed: boolean }).replayed, true);
    const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: multiRecipient.id }, include: { payments: true, inventoryReservations: true } });
    assert.equal(paidOrder.status, "FINALIZED");
    assert.equal(paidOrder.payments.length, 1);
    assert.equal(paidOrder.inventoryReservations.length, 2);
    console.log("S1 passed: local hosted-checkout harness completed a multi-recipient order; signed webhook replay made one payment and two stock reservations.");

    const deliveryDraft = await draftWithRecipients(product.id, [
      { recipientName: "Cid Three", line1: "13 Third Street", postalCode: "11201" },
      { recipientName: "Dee Four", line1: "14 Fourth Street", postalCode: "11205" },
    ]);
    assert.ok(deliveryDraft);
    await startCheckout(deliveryDraft.id, checkoutInput(deliveryDraft, "BULK_DELIVERY"), "http://localhost:3105/api/checkout");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: deliveryDraft.id } })).fulfillmentCents, 2400);
    const perPackageDraft = await draftWithRecipients(product.id, [
      { recipientName: "Fay Six", line1: "16 Sixth Street", postalCode: "11201" },
      { recipientName: "Gia Seven", line1: "17 Seventh Street", postalCode: "11205" },
      { recipientName: "Hal Eight", line1: "18 Eighth Street", postalCode: "11211" },
    ]);
    assert.ok(perPackageDraft);
    await startCheckout(perPackageDraft.id, checkoutInput(perPackageDraft), "http://localhost:3105/api/checkout");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: perPackageDraft.id } })).fulfillmentCents, 2100);
    const outsideDraft = await draftWithRecipients(product.id, [{ recipientName: "Ivy Outside", line1: "19 Ninth Street", postalCode: "10001" }]);
    assert.ok(outsideDraft);
    await assert.rejects(startCheckout(outsideDraft.id, checkoutInput(outsideDraft), "http://localhost:3105/api/checkout"), /outside the local per-package delivery area/);
    console.log("S2 passed: bulk delivery charged two destination fees, per-package charged three recipient fees, and 10001 was hard-blocked.");

    const staleDraft = await draftWithRecipients(product.id, [{ recipientName: "Jay Stale", line1: "20 Tenth Street", postalCode: "11201" }]);
    assert.ok(staleDraft);
    await prisma.product.update({ where: { id: product.id }, data: { priceCents: product.priceCents + 1 } });
    await assert.rejects(startCheckout(staleDraft.id, checkoutInput(staleDraft), "http://localhost:3105/api/checkout"), /changed in price/);
    await prisma.product.update({ where: { id: product.id }, data: { priceCents: product.priceCents } });
    const tampered = await draftWithRecipients(product.id, [{ recipientName: "Kay Tamper", line1: "21 Eleventh Street", postalCode: "11201" }]);
    assert.ok(tampered);
    const tamperedCheckout = await startCheckout(tampered.id, { ...checkoutInput(tampered), totalCents: 1 }, "http://localhost:3105/api/checkout");
    assert.notEqual(tamperedCheckout.totalCents, 1);
    console.log("S3 passed: price changes stopped checkout and a client-supplied total was ignored.");

    const staff = await prisma.staffUser.upsert({
      where: { clerkUserId: "staff-p5-smoke" },
      create: { clerkUserId: "staff-p5-smoke", email: "staff-p5@example.test", displayName: "P5 Staff", role: "STAFF" },
      update: { role: "STAFF", revokedAt: null },
    });
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    process.env.STRIPE_SECRET_KEY = "sk_test_p5_smoke";
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("POS must not call Stripe.");
    };
    const voidAuditsBefore = await prisma.auditEvent.count({ where: { actorId: staff.id, action: "payment.offline_voided" } });
    const cashDraft = await draftWithRecipients(product.id, [{ recipientName: "Liv Cash", line1: "22 Twelfth Street", postalCode: "11201" }]);
    assert.ok(cashDraft);
    const cashPayment = await createPosOrder(cashDraft.id, checkoutInput(cashDraft), "CASH", staff.id, staffRequest().url);
    const checkDraft = await draftWithRecipients(product.id, [{ recipientName: "Moe Check", line1: "23 Thirteenth Street", postalCode: "11205" }]);
    assert.ok(checkDraft);
    const checkPayment = await createPosOrder(checkDraft.id, checkoutInput(checkDraft), "CHECK", staff.id, staffRequest().url);
    assert.equal(cashPayment.method, "CASH");
    assert.equal(checkPayment.method, "CHECK");
    await voidOfflinePayment(cashPayment.id, staff.id);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: cashPayment.id } })).status, "VOIDED");
    assert.equal(await prisma.auditEvent.count({ where: { actorId: staff.id, action: "payment.offline_posted" } }) >= 2, true);
    assert.equal(await prisma.auditEvent.count({ where: { actorId: staff.id, action: "payment.offline_voided" } }), voidAuditsBefore + 1);
    const publicPos = await postOfflinePayment(new Request(`http://localhost:3105/api/admin/orders/${checkDraft.id}/offline-payment`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3105", "x-dev-session": customerRequest().headers.get("x-dev-session")! },
      body: JSON.stringify({ method: "CASH", checkout: checkoutInput(checkDraft) }),
    }), { params: Promise.resolve({ orderId: checkDraft.id }) });
    assert.equal(publicPos.status, 403);
    assert.equal(providerCalls, 0);
    assert.match((await prisma.checkoutSession.findFirstOrThrow({ where: { orderId: cashDraft.id } })).providerSessionId, /^cs_local_/);
    globalThis.fetch = originalFetch;
    delete process.env.STRIPE_SECRET_KEY;
    console.log("S4 passed: staff POS posted cash/check and voided cash with audits; a public caller received 403.");

    const discarded = await createDraft(customerRequest());
    await discardOrder(discarded.draft.id);
    assert.throws(() => assertOrderTransition("FINALIZED", "DISCARDED"), /Cannot transition/);
    const paidIntent = await prisma.stripePaymentIntent.findFirstOrThrow({ where: { orderId: paidOrder.id } });
    const refundEvent = {
      id: `evt_p5_refund_${paidIntent.stripeIntentId}`,
      type: "charge.refunded",
      data: { object: { id: `ch_p5_refund_${paidIntent.stripeIntentId}`, payment_intent: paidIntent.stripeIntentId } },
    };
    const refundBody = JSON.stringify(refundEvent);
    const refundTimestamp = Math.floor(Date.now() / 1000);
    const refundSignature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!).update(`${refundTimestamp}.${refundBody}`).digest("hex");
    assert.equal((await stripeWebhook(new Request("http://localhost:3105/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${refundTimestamp},v1=${refundSignature}` },
      body: refundBody,
    }))).status, 200);
    const refundReplay = await stripeWebhook(new Request("http://localhost:3105/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${refundTimestamp},v1=${refundSignature}` },
      body: refundBody,
    }));
    assert.equal((await refundReplay.json() as { replayed: boolean }).replayed, true);
    const closedDraft = await draftWithRecipients(product.id, [{ recipientName: "Mia Closed", line1: "23 Closed Street", postalCode: "11201" }]);
    assert.ok(closedDraft);
    const closedCheckout = await startCheckout(closedDraft.id, checkoutInput(closedDraft), "http://localhost:3105/api/checkout");
    await prisma.season.update({ where: { year: 2026 }, data: { status: "CLOSED" } });
    await assert.rejects(completeCheckout(closedCheckout.sessionId, `evt_p5_closed_${closedCheckout.sessionId}`), /season must be OPEN/);
    await prisma.season.update({ where: { year: 2026 }, data: { status: "OPEN" } });
    const safetyDraft = await draftWithRecipients(product.id, [{ recipientName: "Nia Safety", line1: "24 Fourteenth Street", postalCode: "11201" }]);
    assert.ok(safetyDraft);
    const safetyCheckout = await startCheckout(safetyDraft.id, checkoutInput(safetyDraft), "http://localhost:3105/api/checkout");
    const safetySession = await prisma.checkoutSession.findUniqueOrThrow({ where: { providerSessionId: safetyCheckout.sessionId } });
    await prisma.order.update({ where: { id: safetyDraft.id }, data: { totalCents: { increment: 1 } } });
    const safetyEvent = { id: `evt_p5_safety_${safetyCheckout.sessionId}`, type: "checkout.session.completed", data: { object: { id: safetyCheckout.sessionId } } };
    const safetyBody = JSON.stringify(safetyEvent);
    const safetyTimestamp = Math.floor(Date.now() / 1000);
    const safetySignature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!).update(`${safetyTimestamp}.${safetyBody}`).digest("hex");
    let refundRequest: RequestInit | undefined;
    process.env.STRIPE_SECRET_KEY = "sk_test_p5_safety";
    globalThis.fetch = async (_input, init) => {
      refundRequest = init;
      return new Response(JSON.stringify({ id: "re_p5_safety" }), { status: 200 });
    };
    const safetyResponse = await stripeWebhook(new Request("http://localhost:3105/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${safetyTimestamp},v1=${safetySignature}` },
      body: safetyBody,
    }));
    globalThis.fetch = originalFetch;
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal((await safetyResponse.json() as { refundNeeded: boolean }).refundNeeded, true);
    assert.equal(new Headers(refundRequest?.headers).get("idempotency-key"), `safety-refund-${safetySession.providerIntentId}`);
    assert.match(String(refundRequest?.body), /payment_intent=pi_local_/);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: paidOrder.id } })).paymentStatus, "REFUNDED");
    assert.ok((await prisma.order.findUniqueOrThrow({ where: { id: cashDraft.id } })).orderNumber !== null);
    console.log("S5 passed: refund events used their payment intent with replay protection; closed seasons blocked completion; safety refunds called Stripe with an idempotency key.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
  await runWithLocalDatabase("tsx", ["scripts/smoke-p5.ts", "verify"]);
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
