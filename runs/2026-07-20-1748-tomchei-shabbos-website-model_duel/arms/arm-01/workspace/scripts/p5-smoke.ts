import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  OrderStatus,
  PaymentMethod,
  PrismaClient,
  StaffRole,
  StaffStatus,
} from "@prisma/client";
import Stripe from "stripe";
import { prepareCheckout } from "../src/domain/checkout";
import {
  assertOrderTransition,
  discardDraft,
} from "../src/domain/order-engine";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, separator)] ??= line.slice(separator + 1);
  }
}

const prisma = new PrismaClient();
const baseUrl = "http://127.0.0.1:3101";
const authSecret = "p5-local-smoke-signing-key-2026";
const webhookSecret = "whsec_p5_local_smoke_2026";
const runKey = randomUUID().slice(0, 8);

function authHeaders(userId: string) {
  const timestamp = Date.now();
  const signature = createHmac("sha256", authSecret)
    .update(`${userId}.${timestamp}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    origin: baseUrl,
    "x-test-clerk-user-id": userId,
    "x-test-auth-token": `${timestamp}.${signature}`,
  };
}

async function createDraft(
  customerId: string,
  seasonId: string,
  product: { id: string; name: string; sku: string; priceCents: number },
  addressIds: string[],
) {
  return prisma.order.create({
    data: {
      seasonId,
      customerId,
      draftReference: `D-P5-${runKey}-${randomUUID().slice(0, 6)}`,
      subtotalCents: product.priceCents * addressIds.length,
      totalCents: product.priceCents * addressIds.length,
      lines: {
        create: addressIds.map((recipientAddressId) => ({
          productId: product.id,
          recipientAddressId,
          recipientSource: "ADDRESS_BOOK",
          recipientNameSnapshot: "P5 recipient",
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          unitPriceCentsSnapshot: product.priceCents,
          quantity: 1,
        })),
      },
    },
    include: { lines: true },
  });
}

function choices(
  order: Awaited<ReturnType<typeof createDraft>>,
  fulfillmentCode: "BULK_DELIVERY" | "PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP",
) {
  return order.lines.map((line) => ({
    orderLineId: line.id,
    fulfillmentCode,
    greeting: `Greeting ${line.id}`,
    deliveryDay: "Purim day",
  }));
}

async function postCheckout(
  order: Awaited<ReturnType<typeof createDraft>>,
  fulfillmentCode: "BULK_DELIVERY" | "PACKAGE_DELIVERY" | "SHIPPING" | "PICKUP",
  expectedTotalCents: number,
  method = "STRIPE",
) {
  return fetch(`${baseUrl}/api/checkout/stripe?draftId=${order.id}`, {
    method: "POST",
    headers: authHeaders("seed_customer"),
    body: JSON.stringify({
      method,
      defaultGreeting: "A freilichen Purim!",
      donationCents: 0,
      expectedTotalCents,
      choices: choices(order, fulfillmentCode),
    }),
  });
}

async function postStripeEvent(event: object) {
  const payload = JSON.stringify(event);
  const stripe = new Stripe("sk_test_local_smoke");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  return fetch(`${baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
}

async function run() {
  const seasonSetting = await prisma.appSetting.findUniqueOrThrow({
    where: { key: "current-season-id" },
  });
  const seasonId = String(seasonSetting.value);
  const customerAccount = await prisma.customerAccount.findUniqueOrThrow({
    where: { clerkUserId: "seed_customer" },
  });
  assert(customerAccount.customerId);
  const customerId = customerAccount.customerId;
  const product = await prisma.product.findFirstOrThrow({
    where: { seasonId, kind: "PACKAGE", tracksInventory: true },
    include: { inventoryItem: true },
  });
  assert(product.inventoryItem);
  await prisma.inventoryItem.update({
    where: { id: product.inventoryItem.id },
    data: { onHand: 1000 },
  });
  const addressInputs = [
    ["P5 One", "101 P5 First St", "08701"],
    ["P5 Two", "102 P5 Second St", "08723"],
    ["P5 Three", "103 P5 Third St", "08527"],
    ["P5 Out", "104 P5 Out St", "99999"],
  ] as const;
  const addresses = [];
  for (const [recipientName, line1, postalCode] of addressInputs) {
    addresses.push(
      await prisma.customerAddress.upsert({
        where: {
          customerId_normalizedKey: {
            customerId,
            normalizedKey: `${line1.toLowerCase().replaceAll(" ", "-")}|lakewood|nj|${postalCode}|us`,
          },
        },
        update: {},
        create: {
          customerId,
          recipientName,
          line1,
          city: "Lakewood",
          region: "NJ",
          postalCode,
          normalizedKey: `${line1.toLowerCase().replaceAll(" ", "-")}|lakewood|nj|${postalCode}|us`,
        },
      }),
    );
  }

  const inventoryBefore = product.inventoryItem.reserved;
  const stripeOrder = await createDraft(
    customerId,
    seasonId,
    product,
    addresses.slice(0, 2).map((address) => address.id),
  );
  const stripeTotal = product.priceCents * 2 + 1200 * 2;
  const checkoutResponse = await postCheckout(stripeOrder, "BULK_DELIVERY", stripeTotal);
  assert.equal(checkoutResponse.status, 200, await checkoutResponse.clone().text());
  const checkoutPayload = await checkoutResponse.json();
  assert.match(checkoutPayload.url, /^\/checkout\/test\?session=/);
  const stripeIntent = await prisma.stripePaymentIntent.findUniqueOrThrow({
    where: { stripeCheckoutSessionId: checkoutPayload.sessionId },
  });
  const stripeEvent = {
    id: `evt_p5_${runKey}`,
    object: "event",
    api_version: "2026-06-30.basil",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkoutPayload.sessionId,
        object: "checkout.session",
        amount_total: stripeIntent.amountCents,
        payment_intent: `pi_p5_${runKey}`,
        metadata: { orderId: stripeOrder.id },
      },
    },
  };
  const webhookResponse = await postStripeEvent(stripeEvent);
  assert.equal(webhookResponse.status, 200, await webhookResponse.text());
  const replayResponse = await postStripeEvent(stripeEvent);
  assert.equal(replayResponse.status, 200, await replayResponse.text());
  const paidOrder = await prisma.order.findUniqueOrThrow({
    where: { id: stripeOrder.id },
    include: { payments: true },
  });
  const inventoryAfter = await prisma.inventoryItem.findUniqueOrThrow({
    where: { id: product.inventoryItem.id },
  });
  assert.equal(paidOrder.status, OrderStatus.FINALIZED);
  assert.equal(paidOrder.cachedPaymentStatus, "PAID");
  assert.equal(paidOrder.payments.length, 1);
  assert.equal(inventoryAfter.reserved - inventoryBefore, 2);
  assert(paidOrder.confirmationTriggeredAt);

  const blockedOrder = await createDraft(customerId, seasonId, product, [addresses[3].id]);
  const blockedResponse = await postCheckout(
    blockedOrder,
    "PACKAGE_DELIVERY",
    product.priceCents + 800,
  );
  assert.equal(blockedResponse.status, 409);
  const bulkOrder = await createDraft(
    customerId,
    seasonId,
    product,
    [addresses[0].id, addresses[0].id, addresses[1].id],
  );
  const bulkTotal = product.priceCents * 3 + 1200 * 2;
  assert.equal((await postCheckout(bulkOrder, "BULK_DELIVERY", bulkTotal)).status, 200);
  const packageOrder = await createDraft(
    customerId,
    seasonId,
    product,
    addresses.slice(0, 3).map((address) => address.id),
  );
  const packageTotal = product.priceCents * 3 + 800 * 3;
  assert.equal(
    (await postCheckout(packageOrder, "PACKAGE_DELIVERY", packageTotal)).status,
    200,
  );
  const sameAddressPackageOrder = await createDraft(
    customerId,
    seasonId,
    product,
    [addresses[0].id, addresses[0].id],
  );
  assert.equal(
    (
      await postCheckout(
        sameAddressPackageOrder,
        "PACKAGE_DELIVERY",
        product.priceCents * 2 + 800 * 2,
      )
    ).status,
    200,
  );

  const stalePriceOrder = await createDraft(customerId, seasonId, product, [addresses[0].id]);
  await prisma.product.update({
    where: { id: product.id },
    data: { priceCents: { increment: 100 } },
  });
  assert.equal(
    (await postCheckout(stalePriceOrder, "BULK_DELIVERY", product.priceCents + 1200)).status,
    409,
  );
  await prisma.product.update({ where: { id: product.id }, data: { priceCents: product.priceCents } });
  const staleStockOrder = await createDraft(customerId, seasonId, product, [addresses[0].id]);
  await prisma.inventoryItem.update({
    where: { id: product.inventoryItem.id },
    data: { onHand: inventoryAfter.reserved },
  });
  assert.equal(
    (await postCheckout(staleStockOrder, "BULK_DELIVERY", product.priceCents + 1200)).status,
    409,
  );
  await prisma.inventoryItem.update({
    where: { id: product.inventoryItem.id },
    data: { onHand: 1000 },
  });
  const tamperedOrder = await createDraft(customerId, seasonId, product, [addresses[0].id]);
  assert.equal(
    (await postCheckout(tamperedOrder, "BULK_DELIVERY", 1)).status,
    409,
  );

  const manager = await prisma.staffUser.upsert({
    where: { email: "p5.manager@example.test" },
    update: {
      clerkUserId: "p5_manager",
      role: StaffRole.MANAGER,
      status: StaffStatus.ACTIVE,
    },
    create: {
      clerkUserId: "p5_manager",
      email: "p5.manager@example.test",
      displayName: "P5 Manager",
      role: StaffRole.MANAGER,
      status: StaffStatus.ACTIVE,
      confirmedAt: new Date(),
    },
  });
  const cashOrder = await createDraft(customerId, seasonId, product, [addresses[0].id]);
  await prepareCheckout(
    prisma,
    cashOrder.id,
    choices(cashOrder, "BULK_DELIVERY"),
    "Cash order greeting",
    0,
    ["08701", "08723", "08527"],
  );
  const cashResponse = await fetch(`${baseUrl}/api/admin/orders/${cashOrder.id}/payments`, {
    method: "POST",
    headers: authHeaders("p5_manager"),
    body: JSON.stringify({
      method: PaymentMethod.CASH,
      amountCents: product.priceCents + 1200,
      reference: `cash-${runKey}`,
    }),
  });
  assert.equal(cashResponse.status, 201, await cashResponse.clone().text());
  const cashPayload = await cashResponse.json();
  const voidResponse = await fetch(`${baseUrl}/api/admin/orders/${cashOrder.id}/payments`, {
    method: "PATCH",
    headers: authHeaders("p5_manager"),
    body: JSON.stringify({ paymentId: cashPayload.payment.id }),
  });
  assert.equal(voidResponse.status, 200, await voidResponse.text());
  const cashLineAfterVoid = await prisma.orderLine.findUniqueOrThrow({
    where: { id: cashOrder.lines[0].id },
  });
  assert.equal(cashLineAfterVoid.fulfillmentFeeCentsSnapshot, 1200);
  assert.equal(
    (await postCheckout(tamperedOrder, "BULK_DELIVERY", product.priceCents + 1200, "CASH"))
      .status,
    400,
  );
  const paymentAudits = await prisma.auditLog.count({
    where: {
      actorStaffId: manager.id,
      action: { in: ["payment.offline_posted", "payment.offline_voided"] },
      metadata: { path: ["orderId"], equals: cashOrder.id },
    },
  });
  assert.equal(paymentAudits, 2);

  assert.doesNotThrow(() => assertOrderTransition(OrderStatus.DRAFT, OrderStatus.FINALIZED));
  assert.throws(() => assertOrderTransition(OrderStatus.CANCELLED, OrderStatus.FINALIZED));
  const discardOrder = await createDraft(customerId, seasonId, product, [addresses[0].id]);
  await discardDraft(prisma, discardOrder.id);
  assert.equal(
    (await prisma.order.findUniqueOrThrow({ where: { id: discardOrder.id } })).status,
    OrderStatus.CANCELLED,
  );
  const finalizedCashOrder = await prisma.order.findUniqueOrThrow({
    where: { id: cashOrder.id },
  });
  assert.notEqual(paidOrder.orderNumber, finalizedCashOrder.orderNumber);

  const partialRefundEvent = {
    ...stripeEvent,
    id: `evt_partial_refund_p5_${runKey}`,
    type: "charge.refunded",
    data: {
      object: {
        id: `ch_p5_${runKey}`,
        object: "charge",
        payment_intent: `pi_p5_${runKey}`,
        amount: stripeIntent.amountCents,
        amount_refunded: Math.floor(stripeIntent.amountCents / 2),
      },
    },
  };
  assert.equal((await postStripeEvent(partialRefundEvent)).status, 200);
  const partiallyRefundedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: stripeOrder.id },
    include: { payments: true },
  });
  assert.equal(partiallyRefundedOrder.cachedPaymentStatus, "PARTIALLY_PAID");
  assert.equal(partiallyRefundedOrder.payments[0]?.status, "POSTED");

  const fullRefundEvent = {
    ...partialRefundEvent,
    id: `evt_full_refund_p5_${runKey}`,
    data: {
      object: {
        ...partialRefundEvent.data.object,
        amount_refunded: stripeIntent.amountCents,
      },
    },
  };
  assert.equal((await postStripeEvent(fullRefundEvent)).status, 200);
  const refundedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: stripeOrder.id },
  });
  assert.equal(refundedOrder.cachedPaymentStatus, "REFUNDED");

  console.log(
    JSON.stringify({
      S1: {
        orderId: stripeOrder.id,
        paymentRows: paidOrder.payments.length,
        stockCommitment: inventoryAfter.reserved - inventoryBefore,
        replaySafe: true,
        confirmationTriggered: Boolean(paidOrder.confirmationTriggeredAt),
      },
      S2: {
        zipBlocked: true,
        bulkDestinations: 2,
        bulkFeeCents: 2400,
        packageRecipients: 3,
        packageFeeCents: 2400,
        sameAddressPackageRecipients: 2,
        sameAddressPackageFeeCents: 1600,
      },
      S3: { stalePrice: 409, staleStock: 409, tamperedTotal: 409 },
      S4: { cashPost: 201, cashVoid: 200, audits: paymentAudits, publicCash: 400 },
      S5: {
        discard: "CANCELLED",
        partialRefund: partiallyRefundedOrder.cachedPaymentStatus,
        partialPaymentStatus: partiallyRefundedOrder.payments[0]?.status,
        fullRefund: refundedOrder.cachedPaymentStatus,
        forbiddenTransition: true,
      },
    }),
  );
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
