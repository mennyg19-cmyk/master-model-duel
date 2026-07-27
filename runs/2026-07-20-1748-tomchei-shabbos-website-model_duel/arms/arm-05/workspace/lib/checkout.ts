import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, type PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";

const deliveryModes = ["SHIP", "PICKUP", "BULK_DELIVERY", "LOCAL_DELIVERY"] as const;
const checkoutSchema = z.object({
  donationCents: z.number().int().min(0).max(100_000).default(0),
  recipients: z.array(z.object({
    addressId: z.string().cuid(),
    method: z.enum(deliveryModes),
    greeting: z.string().trim().min(1).max(280),
    deliveryDate: z.string().date().optional(),
  })).min(1).max(100),
});

type CheckoutInput = z.infer<typeof checkoutSchema>;
type DeliveryRules = {
  allowedZipCodes: string[];
  bulkDeliveryFeeCents: number;
  perPackageDeliveryFeeCents: number;
  deliveryDates: string[];
};

const defaultDeliveryRules: DeliveryRules = {
  allowedZipCodes: ["11201", "11205", "11211"],
  bulkDeliveryFeeCents: 1200,
  perPackageDeliveryFeeCents: 700,
  deliveryDates: [],
};

function isDeliveryRules(value: unknown): value is DeliveryRules {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeliveryRules>;
  return Array.isArray(candidate.allowedZipCodes)
    && Number.isInteger(candidate.bulkDeliveryFeeCents)
    && Number.isInteger(candidate.perPackageDeliveryFeeCents)
    && Array.isArray(candidate.deliveryDates);
}

export async function getDeliveryRules() {
  const setting = await prisma.appSetting.findUnique({ where: { key: "checkout.deliveryRules" } });
  if (isDeliveryRules(setting?.value)) return setting.value;
  const legacyZips = await prisma.appSetting.findUnique({ where: { key: "delivery.zipCodes" } });
  return {
    ...defaultDeliveryRules,
    allowedZipCodes: Array.isArray(legacyZips?.value)
      ? legacyZips.value.filter((zip): zip is string => typeof zip === "string")
      : defaultDeliveryRules.allowedZipCodes,
  };
}

function totalDeliveryFees(recipients: CheckoutInput["recipients"], rules: DeliveryRules) {
  const recipientKeys = new Set<string>();
  const bulkDestinations = new Set<string>();
  for (const recipient of recipients) {
    if (recipient.method === "LOCAL_DELIVERY") recipientKeys.add(recipient.addressId);
    if (recipient.method === "BULK_DELIVERY") bulkDestinations.add(recipient.addressId);
  }
  return recipientKeys.size * rules.perPackageDeliveryFeeCents
    + bulkDestinations.size * rules.bulkDeliveryFeeCents;
}

async function assertLiveOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: {
          product: { include: { inventoryItems: true } },
          productOption: true,
          addOns: { include: { productAddOn: { include: { addOnProduct: { include: { inventoryItems: true } } } } } },
        },
      },
      customer: { include: { addresses: true } },
    },
  });
  if (!order || order.status !== "DRAFT") throw new Error("This checkout is no longer available.");

  let subtotalCents = 0;
  for (const line of order.lines) {
    if (!line.product.isActive) throw new Error(`${line.productNameSnapshot} is no longer available.`);
    const unitPriceCents = line.product.priceCents + (line.productOption?.priceAdjustmentCents ?? 0);
    if (line.unitPriceCents !== unitPriceCents) throw new Error(`${line.product.name} changed in price. Refresh your draft before checkout.`);
    if (line.product.inventoryItems.reduce((sum, item) => sum + item.quantityOnHand - item.quantityReserved, 0) < line.quantity) {
      throw new Error(`${line.product.name} no longer has enough stock.`);
    }
    subtotalCents += unitPriceCents * line.quantity;
    for (const addOn of line.addOns) {
      const product = addOn.productAddOn.addOnProduct;
      if (!product.isActive || product.priceCents !== addOn.unitPriceCents) {
        throw new Error(`${addOn.nameSnapshot} changed in price. Refresh your draft before checkout.`);
      }
      if (product.inventoryItems.reduce((sum, item) => sum + item.quantityOnHand - item.quantityReserved, 0) < addOn.quantity * line.quantity) {
        throw new Error(`${product.name} no longer has enough stock.`);
      }
      subtotalCents += addOn.unitPriceCents * addOn.quantity * line.quantity;
    }
  }
  if (subtotalCents !== order.subtotalCents) throw new Error("Your draft total is stale. Refresh your draft before checkout.");
  return { order, subtotalCents };
}

async function saveCheckoutDetails(orderId: string, parsed: CheckoutInput) {
  const { order, subtotalCents } = await assertLiveOrder(orderId);
  const addresses = new Map(order.customer?.addresses.map((address) => [address.id, address]));
  for (const recipient of parsed.recipients) {
    const address = addresses.get(recipient.addressId);
    if (!address) throw new Error("A checkout recipient does not belong to this draft.");
    if (recipient.method === "LOCAL_DELIVERY" && !((await getDeliveryRules()).allowedZipCodes.includes(address.postalCode.slice(0, 5)))) {
      throw new Error(`${address.recipientName}'s ZIP code is outside the local per-package delivery area.`);
    }
  }

  const rules = await getDeliveryRules();
  for (const recipient of parsed.recipients) {
    if (recipient.method.includes("DELIVERY") && rules.deliveryDates.length > 0 && !recipient.deliveryDate) {
      throw new Error("Choose an available Purim-week delivery date.");
    }
    if (recipient.deliveryDate && !rules.deliveryDates.includes(recipient.deliveryDate)) {
      throw new Error("Choose one of the available Purim-week delivery dates.");
    }
  }
  const fulfillmentCents = totalDeliveryFees(parsed.recipients, rules);
  const checkout = { ...parsed, rules: { ...rules, resolvedAt: new Date().toISOString() } };
  const totalCents = subtotalCents + fulfillmentCents + parsed.donationCents;
  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: {
        fulfillmentCents,
        donationCents: parsed.donationCents,
        totalCents,
        wireFormat: { ...(order.wireFormat as object), checkout },
      },
    }),
    ...parsed.recipients.map((recipient) => prisma.address.update({
      where: { id: recipient.addressId },
      data: { greetingPreference: recipient.greeting },
    })),
  ]);
  return { totalCents, fulfillmentCents, checkout };
}

async function createProviderCheckout(orderId: string, totalCents: number, requestUrl: string, isLocalHarness = false) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (isLocalHarness || !secretKey) {
    const localSessionId = `cs_local_${randomUUID().replaceAll("-", "")}`;
    return { sessionId: localSessionId, paymentIntentId: `pi_local_${randomUUID().replaceAll("-", "")}`, url: `${new URL("/checkout/local", requestUrl)}?session_id=${localSessionId}`, local: true };
  }
  const successUrl = new URL("/checkout/success?session_id={CHECKOUT_SESSION_ID}", requestUrl).toString();
  const cancelUrl = new URL("/checkout", requestUrl).toString();
  const form = new URLSearchParams({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "payment_method_types[0]": "card",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "Tomchei Shabbos Purim order",
    "line_items[0][price_data][unit_amount]": String(totalCents),
    "line_items[0][quantity]": "1",
    client_reference_id: orderId,
    "payment_intent_data[capture_method]": "automatic",
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const body = await response.json() as { id?: string; payment_intent?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !body.id || !body.url) throw new Error(body.error?.message ?? "Stripe could not start checkout.");
  return { sessionId: body.id, paymentIntentId: body.payment_intent ?? body.id, url: body.url, local: false };
}

export async function refundSafetyPayment(paymentIntentId: string | null) {
  if (!paymentIntentId) throw new Error("Safety refund requires a Stripe payment intent ID.");
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { refunded: false, local: true };

  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `safety-refund-${paymentIntentId}`,
    },
    body: new URLSearchParams({ payment_intent: paymentIntentId }),
  });
  const refund = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !refund.id) throw new Error(refund.error?.message ?? "Stripe could not issue the safety refund.");
  return { refunded: true, local: false, refundId: refund.id };
}

export async function startCheckout(orderId: string, input: unknown, requestUrl: string, isLocalHarness = false) {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) throw new Error("Provide valid fulfillment, greeting, and donation details.");
  const details = await saveCheckoutDetails(orderId, parsed.data);
  const provider = await createProviderCheckout(orderId, details.totalCents, requestUrl, isLocalHarness);
  await prisma.checkoutSession.create({
    data: {
      orderId,
      providerSessionId: provider.sessionId,
      providerIntentId: provider.paymentIntentId,
      amountCents: details.totalCents,
      status: "OPEN",
    },
  });
  return { url: provider.url, sessionId: provider.sessionId, local: provider.local, totalCents: details.totalCents };
}

async function reserveLineInventory(
  transaction: Prisma.TransactionClient,
  inventoryItemId: string,
  quantity: number,
  orderId: string,
) {
  const updated = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "InventoryItem"
    SET "quantityReserved" = "quantityReserved" + ${quantity}, "version" = "version" + 1
    WHERE "id" = ${inventoryItemId} AND "isActive" = true
      AND "quantityOnHand" - "quantityReserved" >= ${quantity}
    RETURNING "id"
  `);
  if (!updated[0]) throw new Error("Stock changed while payment was being confirmed.");
  await transaction.inventoryReservation.create({ data: { inventoryItemId, quantity, orderId } });
}

export async function completeCheckout(sessionId: string, eventId: string) {
  return prisma.$transaction(async (transaction) => {
    const session = await transaction.checkoutSession.findUnique({
      where: { providerSessionId: sessionId },
      include: {
        order: {
          include: {
            lines: {
              include: {
                product: { include: { inventoryItems: true } },
                addOns: { include: { productAddOn: { include: { addOnProduct: { include: { inventoryItems: true } } } } } },
              },
            },
          },
        },
      },
    });
    if (!session) throw new Error("Checkout session was not found.");
    try {
      await transaction.webhookEvent.create({ data: { provider: "stripe", externalId: eventId, eventType: "checkout.session.completed" } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return {
          replayed: true,
          refundNeeded: session.status === "SAFETY_REFUND_REQUIRED",
          paymentIntentId: session.providerIntentId,
        };
      }
      throw error;
    }
    if (session.status === "COMPLETED") return { replayed: true, refundNeeded: false };
    if (session.status === "SAFETY_REFUND_REQUIRED") {
      return { replayed: true, refundNeeded: true, paymentIntentId: session.providerIntentId };
    }
    if (session.amountCents !== session.order.totalCents || session.order.status !== "DRAFT") {
      await transaction.checkoutSession.update({ where: { id: session.id }, data: { status: "SAFETY_REFUND_REQUIRED" } });
      return { replayed: false, refundNeeded: true, paymentIntentId: session.providerIntentId };
    }

    const seasons = await transaction.$queryRaw<{ nextOrderNumber: number; status: string }[]>(Prisma.sql`
      SELECT "nextOrderNumber", "status" FROM "Season" WHERE "id" = ${session.order.seasonId} FOR UPDATE
    `);
    const season = seasons[0];
    if (!season) throw new Error("Order season was not found.");
    if (season.status !== "OPEN") {
      throw new Error(`Order season must be OPEN before finalization; current status is ${season.status}.`);
    }

    for (const line of session.order.lines) {
      const inventory = line.product.inventoryItems[0];
      if (!inventory) throw new Error(`${line.product.name} is not inventory-tracked.`);
      await reserveLineInventory(transaction, inventory.id, line.quantity, session.orderId);
      for (const addOn of line.addOns) {
        const addOnInventory = addOn.productAddOn.addOnProduct.inventoryItems[0];
        if (!addOnInventory) throw new Error(`${addOn.productAddOn.addOnProduct.name} is not inventory-tracked.`);
        await reserveLineInventory(transaction, addOnInventory.id, addOn.quantity * line.quantity, session.orderId);
      }
    }
    const payment = await transaction.payment.create({
      data: { orderId: session.orderId, method: "STRIPE", status: "POSTED", amountCents: session.amountCents, externalId: sessionId, postedAt: new Date() },
    });
    await transaction.stripePaymentIntent.upsert({
      where: { stripeIntentId: session.providerIntentId ?? sessionId },
      create: { orderId: session.orderId, paymentId: payment.id, stripeIntentId: session.providerIntentId ?? sessionId, status: "succeeded", amountCents: session.amountCents },
      update: { paymentId: payment.id, status: "succeeded", amountCents: session.amountCents },
    });
    await transaction.order.update({
      where: { id: session.orderId },
      data: { status: "FINALIZED", orderNumber: season.nextOrderNumber, paymentStatus: "POSTED", version: { increment: 1 } },
    });
    await transaction.season.update({ where: { id: session.order.seasonId }, data: { nextOrderNumber: { increment: 1 } } });
    await transaction.checkoutSession.update({ where: { id: session.id }, data: { status: "COMPLETED" } });
    await transaction.auditEvent.create({ data: { action: "checkout.completed", subjectId: session.orderId, details: { sessionId, paymentId: payment.id } } });
    return { replayed: false, refundNeeded: false };
  });
}

export async function postOfflinePayment(orderId: string, method: Extract<PaymentMethod, "CASH" | "CHECK">, actorId: string, notes?: string) {
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== "FINALIZED") throw new Error("Finalize an order before posting an offline payment.");
    const payment = await transaction.payment.create({
      data: { orderId, method, amountCents: order.totalCents, status: "POSTED", postedAt: new Date(), notes },
    });
    await transaction.order.update({ where: { id: orderId }, data: { paymentStatus: "POSTED" } });
    await transaction.auditEvent.create({ data: { actorId, action: "payment.offline_posted", subjectId: payment.id, details: { orderId, method, amountCents: order.totalCents } } });
    return payment;
  });
}

export async function createPosOrder(
  orderId: string,
  input: unknown,
  method: Extract<PaymentMethod, "CASH" | "CHECK">,
  actorId: string,
  requestUrl: string,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { wireFormat: true } });
  const source = order?.wireFormat && typeof order.wireFormat === "object" && !Array.isArray(order.wireFormat)
    ? (order.wireFormat as { source?: unknown }).source
    : undefined;
  if (source !== "POS") throw new Error("Only orders created through staff POS can accept an offline payment.");
  const checkout = await startCheckout(orderId, input, requestUrl, true);
  await completeCheckout(checkout.sessionId, `evt_pos_${checkout.sessionId}`);
  return prisma.$transaction(async (transaction) => {
    const payment = await transaction.payment.findUniqueOrThrow({ where: { externalId: checkout.sessionId } });
    await transaction.stripePaymentIntent.deleteMany({ where: { paymentId: payment.id } });
    const offlinePayment = await transaction.payment.update({
      where: { id: payment.id },
      data: { method, externalId: null, notes: "Posted through staff POS." },
    });
    await transaction.auditEvent.create({
      data: { actorId, action: "payment.offline_posted", subjectId: offlinePayment.id, details: { orderId, method, amountCents: offlinePayment.amountCents } },
    });
    return offlinePayment;
  });
}

export async function voidOfflinePayment(paymentId: string, actorId: string) {
  return prisma.$transaction(async (transaction) => {
    const payment = await transaction.payment.findUnique({ where: { id: paymentId } });
    if (!payment || !["CASH", "CHECK"].includes(payment.method) || payment.status !== "POSTED") throw new Error("Only a posted cash or check payment can be voided.");
    await transaction.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt: new Date() } });
    const activePayments = await transaction.payment.count({ where: { orderId: payment.orderId, status: "POSTED" } });
    await transaction.order.update({ where: { id: payment.orderId }, data: { paymentStatus: activePayments ? "POSTED" : "VOIDED" } });
    await transaction.auditEvent.create({ data: { actorId, action: "payment.offline_voided", subjectId: paymentId, details: { orderId: payment.orderId } } });
  });
}

export async function refundStripePayment(paymentId: string, actorId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { stripeIntent: true } });
  if (!payment || payment.method !== "STRIPE" || payment.status !== "POSTED" || !payment.stripeIntent) {
    throw new Error("Only a posted Stripe payment can be refunded.");
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Stripe refunds require STRIPE_SECRET_KEY.");
  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": `staff-refund-${payment.id}` },
    body: new URLSearchParams({ payment_intent: payment.stripeIntent.stripeIntentId }),
  });
  const body = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) throw new Error(body.error?.message ?? "Stripe could not issue the refund.");
  await prisma.$transaction(async (transaction) => {
    await transaction.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
    const activePayments = await transaction.payment.count({ where: { orderId: payment.orderId, status: "POSTED" } });
    await transaction.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: activePayments ? "POSTED" : "REFUNDED" },
    });
    await transaction.auditEvent.create({
      data: { actorId, action: "payment.stripe_refunded", subjectId: payment.id, details: { orderId: payment.orderId, refundId: body.id } },
    });
  });
}

export function isValidStripeSignature(body: string, signature: string | null, secret: string | undefined) {
  if (!signature || !secret) return false;
  const timestamp = signature.match(/(?:^|,)t=(\d+)/)?.[1];
  const expected = signature.match(/(?:^|,)v1=([a-f0-9]+)/)?.[1];
  if (!timestamp || !expected || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return digest.length === expected.length && timingSafeEqual(Buffer.from(digest), Buffer.from(expected));
}
