import { AuditAction, OrderStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertPerPackageZipsAllowed,
  loadAllowedDeliveryZips,
  loadDeliveryFees,
  loadPurimWeekDays,
  resolveDeliveryFees,
  ZipBlockedError,
  type CheckoutLineForFees,
} from "@/lib/checkout/delivery";
import {
  rememberRecipientGreeting,
  resolveLineGreeting,
  lookupRememberedGreeting,
} from "@/lib/checkout/greetings";
import {
  validateCheckoutLines,
  type CheckoutConflict,
  type ValidationLine,
} from "@/lib/checkout/validation";
import { buildGroupingKey } from "@/lib/orders/grouping";
import { draftSubtotalCents } from "@/lib/orders/totals";
import {
  appUrl,
  getStripe,
  getStripeMode,
  mintMockSessionId,
} from "@/lib/stripe/client";
import { err, maskError, ok, type Result } from "@/lib/result";

export type RecipientFulfillmentInput = {
  /** Lines sharing this recipient destination get this method. */
  lineIds: string[];
  fulfillmentMethodCode: string;
  greeting?: string | null;
  purimDay?: string | null;
};

export type PrepareCheckoutInput = {
  orderId: string;
  recipients: RecipientFulfillmentInput[];
  greetingDefault?: string | null;
  donationCents?: number;
  /** Client-reported total for stale-total detection. */
  clientExpectedTotalCents?: number | null;
  /** Re-snapshot line/add-on unit prices from catalog before validate. */
  refreshPrices?: boolean;
};

type CheckoutOrder = Awaited<ReturnType<typeof loadOrderForCheckout>>;

async function loadOrderForCheckout(orderId: string) {
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      lines: {
        include: {
          product: { include: { inventory: true } },
          productOption: true,
          addOns: { include: { addOn: { include: { inventory: true } } } },
          fulfillmentMethod: true,
        },
      },
      season: true,
      customer: true,
    },
  });
}

function toFeeLines(order: CheckoutOrder): CheckoutLineForFees[] {
  return order.lines.map((l) => ({
    id: l.id,
    recipientName: l.recipientName,
    addressLine1: l.addressLine1,
    city: l.city,
    state: l.state,
    postalCode: l.postalCode,
    country: l.country,
    fulfillmentMethodCode: l.fulfillmentMethod?.code ?? null,
  }));
}

function toValidationLines(order: CheckoutOrder): ValidationLine[] {
  return order.lines.map((line) => ({
    id: line.id,
    productId: line.productId,
    productSku: line.product.sku,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    optionAdjustCents: line.optionAdjustCents,
    currentProductPriceCents: line.product.basePriceCents,
    currentOptionAdjustCents: line.productOption?.priceAdjustmentCents ?? 0,
    tracksInventory: line.product.tracksInventory,
    onHand: line.product.inventory?.onHand ?? 0,
    reserved: line.product.inventory?.reserved ?? 0,
    assigned: Boolean(line.recipientName && line.addressLine1),
    fulfillmentMethodId: line.fulfillmentMethodId,
    addOns: line.addOns.map((a) => ({
      addOnId: a.addOnId,
      sku: a.addOn.sku,
      quantity: a.quantity,
      unitPriceCents: a.unitPriceCents,
      currentPriceCents: a.addOn.priceCents,
      tracksInventory: a.addOn.tracksInventory,
      onHand: a.addOn.inventory?.onHand ?? 0,
      reserved: a.addOn.inventory?.reserved ?? 0,
    })),
  }));
}

/** Server refresh path: write current catalog prices onto draft lines/add-ons. */
export async function refreshOrderLinePrices(orderId: string): Promise<void> {
  const order = await loadOrderForCheckout(orderId);
  if (order.status !== OrderStatus.DRAFT) {
    throw new Error("Only draft orders can refresh line prices.");
  }

  await db.$transaction(async (tx) => {
    for (const line of order.lines) {
      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          unitPriceCents: line.product.basePriceCents,
          optionAdjustCents: line.productOption?.priceAdjustmentCents ?? 0,
        },
      });
      for (const addOn of line.addOns) {
        await tx.orderLineAddOn.update({
          where: { id: addOn.id },
          data: { unitPriceCents: addOn.addOn.priceCents },
        });
      }
    }
    await tx.order.update({
      where: { id: orderId },
      data: { version: { increment: 1 } },
    });
  });
}

export async function buildCheckoutSummary(orderId: string) {
  const order = await loadOrderForCheckout(orderId);
  const fees = await loadDeliveryFees();
  const zips = await loadAllowedDeliveryZips();
  const purimDays = await loadPurimWeekDays();
  const methods = await db.fulfillmentMethod.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  const feeLines = toFeeLines(order);
  const breakdown = resolveDeliveryFees(feeLines, fees, zips);
  const validation = validateCheckoutLines(toValidationLines(order), {
    feesCents: breakdown.totalFeeCents,
    donationCents: order.donationCents,
  });

  const remembered: Record<string, string> = {};
  if (order.customerId) {
    for (const line of order.lines) {
      if (!line.recipientName || !line.addressLine1) continue;
      const g = await lookupRememberedGreeting({
        customerId: order.customerId,
        recipientName: line.recipientName,
        addressLine1: line.addressLine1,
        city: line.city ?? "",
        state: line.state ?? "",
        postalCode: line.postalCode ?? "",
        country: line.country,
      });
      if (g) remembered[line.id] = g;
    }
  }

  return {
    orderId: order.id,
    draftRef: order.draftRef,
    status: order.status,
    customerId: order.customerId,
    greetingDefault: order.greetingDefault,
    donationCents: order.donationCents,
    subtotalCents: validation.subtotalCents,
    fees: breakdown,
    totalCents: validation.subtotalCents + breakdown.totalFeeCents + order.donationCents,
    conflicts: validation.conflicts,
    purimDays,
    methods: methods.map((m) => ({
      id: m.id,
      code: m.code,
      label: m.label,
      description: m.description,
    })),
    lines: order.lines.map((l) => ({
      id: l.id,
      productName: l.product.name,
      productSku: l.product.sku,
      quantity: l.quantity,
      lineTotalCents: draftSubtotalCents([
        {
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          optionAdjustCents: l.optionAdjustCents,
          addOns: l.addOns,
        },
      ]),
      recipientName: l.recipientName,
      addressLine1: l.addressLine1,
      city: l.city,
      state: l.state,
      postalCode: l.postalCode,
      fulfillmentMethodCode: l.fulfillmentMethod?.code ?? null,
      greeting: l.greeting,
      rememberedGreeting: remembered[l.id] ?? null,
      effectiveGreeting: resolveLineGreeting(
        l.greeting,
        order.greetingDefault,
        remembered[l.id],
      ),
    })),
  };
}

export async function prepareCheckout(
  input: PrepareCheckoutInput,
): Promise<
  Result<{
    summary: Awaited<ReturnType<typeof buildCheckoutSummary>>;
    conflicts: CheckoutConflict[];
  }>
> {
  try {
    const order = await loadOrderForCheckout(input.orderId);
    if (order.status !== OrderStatus.DRAFT) {
      return err("status", "Only draft orders can be prepared for checkout.");
    }

    if (input.refreshPrices) {
      await refreshOrderLinePrices(input.orderId);
    }

    const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
    const byCode = new Map(methods.map((m) => [m.code, m]));
    const purimDays = await loadPurimWeekDays();

    const greetingDefault =
      input.greetingDefault !== undefined
        ? (input.greetingDefault ?? "")
        : order.greetingDefault;
    const donationCents =
      input.donationCents !== undefined ? input.donationCents : order.donationCents;

    // Validate recipients before writes.
    for (const recipient of input.recipients) {
      const method = byCode.get(recipient.fulfillmentMethodCode);
      if (!method) {
        return err("method", `Unknown fulfillment method ${recipient.fulfillmentMethodCode}`);
      }
      if (
        recipient.purimDay &&
        (recipient.fulfillmentMethodCode === "BULK_DELIVERY" ||
          recipient.fulfillmentMethodCode === "PER_PACKAGE_DELIVERY") &&
        !purimDays.includes(recipient.purimDay)
      ) {
        return err("purim_day", `Invalid Purim-week day ${recipient.purimDay}`);
      }
      for (const lineId of recipient.lineIds) {
        const line = order.lines.find((l) => l.id === lineId);
        if (!line) return err("line", `Unknown line ${lineId}`);
        if (!line.recipientName || !line.addressLine1 || !line.city || !line.state || !line.postalCode) {
          return err("unassigned", "Assign recipients before choosing fulfillment.");
        }
      }
    }

    await db.$transaction(async (tx) => {
      if (input.greetingDefault !== undefined || input.donationCents !== undefined) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            ...(input.greetingDefault !== undefined
              ? { greetingDefault: input.greetingDefault ?? "" }
              : {}),
            ...(input.donationCents !== undefined
              ? { donationCents: input.donationCents }
              : {}),
            version: { increment: 1 },
          },
        });
      }

      for (const recipient of input.recipients) {
        const method = byCode.get(recipient.fulfillmentMethodCode)!;
        for (const lineId of recipient.lineIds) {
          const line = order.lines.find((l) => l.id === lineId)!;
          const greeting = resolveLineGreeting(
            recipient.greeting,
            greetingDefault,
            null,
          );
          const groupingKey = buildGroupingKey({
            recipientName: line.recipientName!,
            addressLine1: line.addressLine1!,
            city: line.city!,
            state: line.state!,
            postalCode: line.postalCode!,
            country: line.country ?? "US",
            fulfillmentMethodCode: method.code,
            greeting,
          });

          await tx.orderLine.update({
            where: { id: line.id },
            data: {
              fulfillmentMethodId: method.id,
              greeting,
              groupingKey,
            },
          });

          if (order.customerId && greeting) {
            await rememberRecipientGreeting({
              customerId: order.customerId,
              seasonId: order.seasonId,
              recipientName: line.recipientName!,
              addressLine1: line.addressLine1!,
              city: line.city!,
              state: line.state!,
              postalCode: line.postalCode!,
              country: line.country,
              greeting,
              tx,
            });
          }
        }
      }
    });

    const refreshed = await loadOrderForCheckout(input.orderId);
    const feeSettings = await loadDeliveryFees();
    const zips = await loadAllowedDeliveryZips();
    const feeLines = toFeeLines(refreshed);
    const breakdown = resolveDeliveryFees(feeLines, feeSettings, zips);

    try {
      assertPerPackageZipsAllowed(breakdown);
    } catch (error) {
      if (error instanceof ZipBlockedError) {
        return ok({
          summary: await buildCheckoutSummary(input.orderId),
          conflicts: [
            {
              kind: "zip_blocked",
              zips: error.zips,
              message: error.message,
            },
          ],
        });
      }
      throw error;
    }

    const validation = validateCheckoutLines(toValidationLines(refreshed), {
      clientExpectedTotalCents: input.clientExpectedTotalCents,
      feesCents: breakdown.totalFeeCents,
      donationCents: refreshed.donationCents,
    });

    const expectedTotal =
      validation.subtotalCents + breakdown.totalFeeCents + refreshed.donationCents;

    const snapshot: Prisma.InputJsonValue = {
      fees: breakdown,
      subtotalCents: validation.subtotalCents,
      donationCents: refreshed.donationCents,
      expectedTotalCents: expectedTotal,
      capturedAt: new Date().toISOString(),
    };

    if (validation.ok) {
      await db.order.update({
        where: { id: order.id },
        data: {
          expectedTotalCents: expectedTotal,
          fulfillmentFeeCents: breakdown.totalFeeCents,
          checkoutSnapshot: snapshot,
          version: { increment: 1 },
        },
      });
    }

    return ok({
      summary: await buildCheckoutSummary(input.orderId),
      conflicts: validation.conflicts,
    });
  } catch (error) {
    return err(maskError(error), "Could not prepare checkout.");
  }
}

export async function createHostedCheckoutSession(input: {
  orderId: string;
  clientExpectedTotalCents?: number | null;
}): Promise<
  Result<{
    sessionId: string;
    url: string;
    amountCents: number;
    conflicts?: CheckoutConflict[];
  }>
> {
  try {
    const order = await loadOrderForCheckout(input.orderId);
    if (order.status !== OrderStatus.DRAFT) {
      return err("status", "Only draft orders can start Stripe checkout.");
    }

    const feeSettings = await loadDeliveryFees();
    const zips = await loadAllowedDeliveryZips();
    const feeLines = toFeeLines(order);
    const breakdown = resolveDeliveryFees(feeLines, feeSettings, zips);

    try {
      assertPerPackageZipsAllowed(breakdown);
    } catch (error) {
      if (error instanceof ZipBlockedError) {
        return ok({
          sessionId: "",
          url: "",
          amountCents: 0,
          conflicts: [
            {
              kind: "zip_blocked",
              zips: error.zips,
              message: error.message,
            },
          ],
        });
      }
      throw error;
    }

    const validation = validateCheckoutLines(toValidationLines(order), {
      clientExpectedTotalCents: input.clientExpectedTotalCents,
      feesCents: breakdown.totalFeeCents,
      donationCents: order.donationCents,
    });
    if (!validation.ok) {
      return ok({
        sessionId: "",
        url: "",
        amountCents: 0,
        conflicts: validation.conflicts,
      });
    }

    const amountCents =
      validation.subtotalCents + breakdown.totalFeeCents + order.donationCents;

    // Persist expected total before calling Stripe (committed snapshot).
    await db.order.update({
      where: { id: order.id },
      data: {
        expectedTotalCents: amountCents,
        fulfillmentFeeCents: breakdown.totalFeeCents,
        checkoutSnapshot: {
          fees: breakdown,
          subtotalCents: validation.subtotalCents,
          donationCents: order.donationCents,
          expectedTotalCents: amountCents,
        },
        version: { increment: 1 },
      },
    });

    const mode = getStripeMode();
    let sessionId: string;
    let url: string;

    if (mode === "mock" || !getStripe()) {
      sessionId = mintMockSessionId();
      url = `${appUrl()}/checkout/mock-pay?session_id=${sessionId}&draft=${order.draftRef}`;
    } else {
      const stripe = getStripe()!;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        // Immediate capture (UR-011) — Checkout payment_intent is captured by default.
        success_url: `${appUrl()}/checkout/success?session_id={CHECKOUT_SESSION_ID}&draft=${order.draftRef}`,
        cancel_url: `${appUrl()}/checkout?draft=${order.draftRef}&cancelled=1`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: amountCents,
              product_data: {
                name: `Tomchei order ${order.draftRef}`,
              },
            },
          },
        ],
        metadata: { orderId: order.id, draftRef: order.draftRef },
      });
      sessionId = session.id;
      url = session.url ?? `${appUrl()}/checkout?draft=${order.draftRef}`;
    }

    await db.$transaction(async (tx) => {
      await tx.stripeCheckoutSession.create({
        data: {
          orderId: order.id,
          stripeSessionId: sessionId,
          amountCents,
          status: "open",
          url,
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.CHECKOUT_STARTED,
          meta: {
            orderId: order.id,
            draftRef: order.draftRef,
            sessionId,
            amountCents,
            mode,
          },
        },
      });
    });

    return ok({ sessionId, url, amountCents });
  } catch (error) {
    if (error instanceof ZipBlockedError) {
      return ok({
        sessionId: "",
        url: "",
        amountCents: 0,
        conflicts: [
          {
            kind: "zip_blocked",
            zips: error.zips,
            message: error.message,
          },
        ],
      });
    }
    return err(maskError(error), "Could not start Stripe checkout.");
  }
}
