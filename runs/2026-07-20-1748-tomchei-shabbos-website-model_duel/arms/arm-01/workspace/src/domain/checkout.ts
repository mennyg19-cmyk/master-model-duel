import {
  CachedPaymentStatus,
  PaymentIntentStatus,
  PaymentMethod,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

export const fulfillmentFees = {
  BULK_DELIVERY: 1200,
  PACKAGE_DELIVERY: 800,
  SHIPPING: 1800,
  PICKUP: 0,
} as const;

export type CheckoutLineChoice = {
  orderLineId: string;
  fulfillmentCode: keyof typeof fulfillmentFees;
  greeting: string;
  deliveryDay?: string | null;
};

export class CheckoutConflictError extends Error {
  constructor(
    message: string,
    readonly conflicts: string[],
  ) {
    super(message);
    this.name = "CheckoutConflictError";
  }
}

function getFeeGroup(choice: CheckoutLineChoice, addressId: string) {
  return choice.fulfillmentCode === "PACKAGE_DELIVERY"
    ? `${choice.fulfillmentCode}:${choice.orderLineId}`
    : `${choice.fulfillmentCode}:${addressId}`;
}

export function calculateFulfillmentFees(
  choices: CheckoutLineChoice[],
  addressIdsByLineId: ReadonlyMap<string, string>,
) {
  const chargedGroups = new Set<string>();
  const feesByLineId = new Map<string, number>();
  for (const choice of choices) {
    const addressId = addressIdsByLineId.get(choice.orderLineId);
    if (!addressId) {
      throw new CheckoutConflictError("Every gift needs a recipient before checkout.", [
        "Choose a recipient for every cart line.",
      ]);
    }
    const group = getFeeGroup(choice, addressId);
    const fee = chargedGroups.has(group) ? 0 : fulfillmentFees[choice.fulfillmentCode];
    chargedGroups.add(group);
    feesByLineId.set(choice.orderLineId, fee);
  }
  return feesByLineId;
}

async function loadCheckoutOrder(prisma: PrismaClient | Prisma.TransactionClient, orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        include: {
          product: { include: { inventoryItem: true } },
          productOption: true,
          addOns: { include: { addOnProduct: { include: { addOnInventoryItem: true } } } },
          recipientAddress: true,
        },
      },
      season: { include: { fulfillmentMethods: true } },
    },
  });
}

function findCheckoutConflicts(
  order: NonNullable<Awaited<ReturnType<typeof loadCheckoutOrder>>>,
) {
  const conflicts: string[] = [];
  for (const line of order.lines) {
    const currentUnitPrice =
      line.product.priceCents +
      (line.productOption?.priceAdjustmentCents ?? 0) +
      line.addOns.reduce((sum, addOn) => sum + addOn.addOnProduct.priceCents, 0);
    if (currentUnitPrice !== line.unitPriceCentsSnapshot) {
      conflicts.push(`${line.product.name} changed price. Review the updated cart total.`);
    }
    if (line.product.tracksInventory) {
      const available =
        (line.product.inventoryItem?.onHand ?? 0) -
        (line.product.inventoryItem?.reserved ?? 0);
      if (available < line.quantity) {
        conflicts.push(`${line.product.name} now has only ${Math.max(0, available)} available.`);
      }
    }
    for (const addOn of line.addOns) {
      if (addOn.unitPriceCentsSnapshot !== addOn.addOnProduct.priceCents) {
        conflicts.push(`${addOn.addOnProduct.name} changed price.`);
      }
      if (addOn.addOnProduct.tracksInventory) {
        const available =
          (addOn.addOnProduct.addOnInventoryItem?.onHand ?? 0) -
          (addOn.addOnProduct.addOnInventoryItem?.reserved ?? 0);
        if (available < addOn.quantity) {
          conflicts.push(
            `${addOn.addOnProduct.name} now has only ${Math.max(0, available)} available.`,
          );
        }
      }
    }
  }
  return [...new Set(conflicts)];
}

async function reserveOrderInventory(
  transaction: Prisma.TransactionClient,
  order: NonNullable<Awaited<ReturnType<typeof loadCheckoutOrder>>>,
) {
  const inventoryQuantities = new Map<string, number>();
  for (const line of order.lines) {
    if (line.product.tracksInventory && line.product.inventoryItem) {
      inventoryQuantities.set(
        line.product.inventoryItem.id,
        (inventoryQuantities.get(line.product.inventoryItem.id) ?? 0) + line.quantity,
      );
    }
    for (const addOn of line.addOns) {
      if (addOn.addOnProduct.tracksInventory && addOn.addOnProduct.addOnInventoryItem) {
        const inventoryId = addOn.addOnProduct.addOnInventoryItem.id;
        inventoryQuantities.set(
          inventoryId,
          (inventoryQuantities.get(inventoryId) ?? 0) + addOn.quantity,
        );
      }
    }
  }
  for (const [inventoryId, quantity] of inventoryQuantities) {
    const reservedRows = await transaction.$executeRaw`
      UPDATE "InventoryItem"
      SET "reserved" = "reserved" + ${quantity},
          "version" = "version" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND "onHand" - "reserved" >= ${quantity}
    `;
    if (reservedRows !== 1) {
      throw new CheckoutConflictError("Inventory changed during payment.", [
        "One or more gifts sold out during checkout.",
      ]);
    }
  }
}

export async function prepareCheckout(
  prisma: PrismaClient,
  orderId: string,
  choices: CheckoutLineChoice[],
  defaultGreeting: string,
  donationCents: number,
  allowedDeliveryZips: string[],
) {
  const order = await loadCheckoutOrder(prisma, orderId);
  if (!order || order.status !== "DRAFT") {
    throw new CheckoutConflictError("This draft is no longer available.", [
      "Reload the order before checking out.",
    ]);
  }
  if (choices.length !== order.lines.length) {
    throw new CheckoutConflictError("Every gift needs checkout choices.", [
      "Choose fulfillment and greeting details for every recipient.",
    ]);
  }
  const choicesByLineId = new Map(choices.map((choice) => [choice.orderLineId, choice]));
  if (choicesByLineId.size !== order.lines.length) {
    throw new CheckoutConflictError("Checkout choices contain duplicate or missing gifts.", [
      "Reload the checkout page and try again.",
    ]);
  }
  const conflicts = findCheckoutConflicts(order);
  if (conflicts.length) {
    throw new CheckoutConflictError("Your cart changed before payment.", conflicts);
  }

  const methodsByCode = new Map(
    order.season.fulfillmentMethods
      .filter((method) => method.isActive)
      .map((method) => [method.code, method]),
  );
  const addressesByLineId = new Map(
    order.lines.flatMap((line) =>
      line.recipientAddressId ? [[line.id, line.recipientAddressId] as const] : [],
    ),
  );
  const feesByLineId = calculateFulfillmentFees(choices, addressesByLineId);
  for (const line of order.lines) {
    const choice = choicesByLineId.get(line.id);
    if (!choice || !methodsByCode.has(choice.fulfillmentCode)) {
      throw new CheckoutConflictError("A fulfillment choice is unavailable.", [
        "Choose an active fulfillment method for every recipient.",
      ]);
    }
    if (
      choice.fulfillmentCode === "PACKAGE_DELIVERY" &&
      (!line.recipientAddress ||
        !allowedDeliveryZips.includes(line.recipientAddress.postalCode.trim()))
    ) {
      throw new CheckoutConflictError("Per-package delivery is outside the delivery area.", [
        `${line.recipientAddress?.postalCode ?? "This address"} cannot use per-package delivery.`,
      ]);
    }
  }

  const subtotalCents = order.lines.reduce(
    (sum, line) => sum + line.unitPriceCentsSnapshot * line.quantity,
    0,
  );
  const fulfillmentCents = [...feesByLineId.values()].reduce((sum, fee) => sum + fee, 0);
  const totalCents = subtotalCents + fulfillmentCents + donationCents;
  await prisma.$transaction(async (transaction) => {
    for (const choice of choices) {
      const method = methodsByCode.get(choice.fulfillmentCode)!;
      await transaction.orderLine.update({
        where: { id: choice.orderLineId },
        data: {
          fulfillmentMethodId: method.id,
          fulfillmentFeeCentsSnapshot: feesByLineId.get(choice.orderLineId) ?? 0,
          greetingSnapshot: choice.greeting.trim() || defaultGreeting.trim(),
          deliveryDay: choice.deliveryDay || null,
        },
      });
    }
    await transaction.order.update({
      where: { id: order.id },
      data: {
        subtotalCents,
        donationCents,
        totalCents,
        defaultGreeting: defaultGreeting.trim(),
        version: { increment: 1 },
      },
    });
  });
  return { order, subtotalCents, fulfillmentCents, totalCents };
}

export async function commitStripePayment(
  prisma: PrismaClient,
  eventId: string,
  orderId: string,
  stripePaymentIntentId: string,
  amountCents: number,
) {
  return prisma.$transaction(
    async (transaction) => {
      const priorEvent = await transaction.stripeWebhookEvent.findUnique({
        where: { id: eventId },
      });
      if (priorEvent) return { replayed: true };

      await transaction.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const order = await loadCheckoutOrder(transaction, orderId);
      if (!order) throw new CheckoutConflictError("Paid order was not found.", ["Order missing."]);
      if (order.status === "FINALIZED") {
        await transaction.stripeWebhookEvent.create({ data: { id: eventId, type: "checkout.session.completed" } });
        return { replayed: true };
      }
      const conflicts = findCheckoutConflicts(order);
      if (amountCents !== order.totalCents) {
        conflicts.push("The charged amount does not match the current order total.");
      }
      if (conflicts.length) {
        throw new CheckoutConflictError("The paid order became stale.", conflicts);
      }

      await reserveOrderInventory(transaction, order);

      const season = await transaction.season.update({
        where: { id: order.seasonId },
        data: { nextOrderNumber: { increment: 1 } },
        select: { nextOrderNumber: true },
      });
      await transaction.order.update({
        where: { id: order.id },
        data: {
          status: "FINALIZED",
          orderNumber: season.nextOrderNumber - 1,
          finalizedAt: new Date(),
          cachedPaymentStatus: CachedPaymentStatus.PAID,
          confirmationTriggeredAt: new Date(),
          version: { increment: 1 },
        },
      });
      await transaction.payment.upsert({
        where: {
          method_reference: {
            method: PaymentMethod.STRIPE,
            reference: stripePaymentIntentId,
          },
        },
        create: {
          orderId,
          method: PaymentMethod.STRIPE,
          amountCents,
          reference: stripePaymentIntentId,
        },
        update: {},
      });
      const activeIntent = await transaction.stripePaymentIntent.findFirst({
        where: {
          orderId,
          status: { in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.PROCESSING] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (activeIntent) {
        await transaction.stripePaymentIntent.update({
          where: { id: activeIntent.id },
          data: {
            stripePaymentIntentId,
            status: PaymentIntentStatus.SUCCEEDED,
            amountCents,
          },
        });
      }
      for (const line of order.lines) {
        if (line.recipientAddressId && line.greetingSnapshot) {
          await transaction.customerAddress.update({
            where: { id: line.recipientAddressId },
            data: { rememberedGreeting: line.greetingSnapshot },
          });
        }
      }
      await transaction.stripeWebhookEvent.create({
        data: { id: eventId, type: "checkout.session.completed" },
      });
      return { replayed: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function finalizePosOrder(
  transaction: Prisma.TransactionClient,
  orderId: string,
) {
  await transaction.$queryRaw`
    SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
  `;
  const order = await loadCheckoutOrder(transaction, orderId);
  if (!order || order.status !== "DRAFT") {
    throw new CheckoutConflictError("Payment requires an active draft order.", [
      "Reload the order before posting payment.",
    ]);
  }
  if (
    order.lines.some(
      (line) =>
        !line.fulfillmentMethodId ||
        !line.recipientAddressId ||
        !line.greetingSnapshot ||
        line.fulfillmentFeeCentsSnapshot < 0,
    )
  ) {
    throw new CheckoutConflictError("Prepare fulfillment before posting payment.", [
      "Every line needs recipient, greeting, fulfillment, and fee snapshots.",
    ]);
  }
  const conflicts = findCheckoutConflicts(order);
  if (conflicts.length) {
    throw new CheckoutConflictError("The order changed before payment.", conflicts);
  }
  await reserveOrderInventory(transaction, order);
  const season = await transaction.season.update({
    where: { id: order.seasonId },
    data: { nextOrderNumber: { increment: 1 } },
    select: { nextOrderNumber: true },
  });
  await transaction.order.update({
    where: { id: order.id },
    data: {
      status: "FINALIZED",
      orderNumber: season.nextOrderNumber - 1,
      finalizedAt: new Date(),
      version: { increment: 1 },
    },
  });
}

export async function recalculatePaymentStatus(
  prisma: PrismaClient | Prisma.TransactionClient,
  orderId: string,
) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true, paymentIntents: true },
  });
  const postedCents = order.payments
    .filter((payment) => payment.status === "POSTED")
    .reduce(
      (sum, payment) => sum + Math.max(0, payment.amountCents - payment.refundedCents),
      0,
    );
  const isRefunded =
    order.paymentIntents.length > 0 &&
    order.paymentIntents.every((intent) => intent.status === PaymentIntentStatus.REFUNDED);
  const cachedPaymentStatus = isRefunded
    ? CachedPaymentStatus.REFUNDED
    : postedCents >= order.totalCents
      ? CachedPaymentStatus.PAID
      : postedCents > 0
        ? CachedPaymentStatus.PARTIALLY_PAID
        : CachedPaymentStatus.UNPAID;
  await prisma.order.update({
    where: { id: orderId },
    data: { cachedPaymentStatus },
  });
  return cachedPaymentStatus;
}
