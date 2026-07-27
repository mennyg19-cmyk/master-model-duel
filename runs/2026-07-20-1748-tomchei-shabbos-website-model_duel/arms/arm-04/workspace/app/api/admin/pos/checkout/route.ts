import { z } from "zod";
import { db } from "@/lib/db";
import { getOpenSeason } from "@/lib/season";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { cartSchema } from "@/lib/order-builder/cart";
import { posDraftOwner, findActiveDraft, completeDraft } from "@/lib/order-builder/draft-store";
import { createOrderFromCart } from "@/lib/checkout/create-order";
import { finalizeOrder } from "@/lib/domain/finalize";
import { postPayment } from "@/lib/payments/post-payment";

const checkoutSchema = z.object({
  customerId: z.string().min(1),
  choices: z.array(z.object({ recipientKey: z.string(), methodId: z.string() })),
  deliveryDay: z.string().nullable().default(null),
  greetingDefault: z.string().max(500).default(""),
  greetingOverrides: z
    .array(z.object({ recipientKey: z.string(), greeting: z.string().max(500) }))
    .default([]),
  expectedTotalCents: z.number().int().min(1),
  // POS is offline money only (UR-011, G-028): Stripe never happens here, and
  // no public route accepts CASH/CHECK — this staff gate is the only door.
  payment: z.object({
    method: z.enum(["CASH", "CHECK"]),
    amountCents: z.number().int().min(1).optional(),
    note: z.string().max(500).optional(),
  }),
});

/**
 * POS checkout (R-061, UR-006, UR-011): converts the POS draft through the
 * SAME createOrderFromCart path web checkout uses (price/stock/fee re-derive,
 * conflict refusal), then finalizes and posts the audited cash/check payment.
 */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;
  if (!gate.staff.actingAs.permissions.has("payments.record")) {
    return Response.json({ error: "Missing permission: payments.record" }, { status: 403 });
  }

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const input = parsed.data;

  const draft = await findActiveDraft(season.id, posDraftOwner(input.customerId));
  if (!draft) return Response.json({ error: "No POS cart for this customer" }, { status: 404 });

  const result = await createOrderFromCart({
    cart: cartSchema.parse(draft.cart),
    customerId: input.customerId,
    guestContact: null,
    choices: input.choices,
    deliveryDay: input.deliveryDay,
    greetingDefault: input.greetingDefault,
    greetingOverrides: input.greetingOverrides,
    donationCents: 0,
    expectedTotalCents: input.expectedTotalCents,
    sourceDraftId: draft.id,
  });
  if (result.kind === "conflict") {
    return Response.json(
      { error: result.errors.join("; "), freshTotalCents: result.freshTotalCents },
      { status: 409 }
    );
  }

  // Payment, finalize (stock reserve + order number + packages), and both
  // audit rows commit in ONE transaction: a stock conflict rolls the money
  // back too, so no DRAFT order is ever left holding a POSTED payment.
  const amountCents = input.payment.amountCents ?? result.totalCents;
  let orderNumber: number | null;
  try {
    orderNumber = await db.$transaction(async (tx) => {
      const payment = await postPayment({
        orderId: result.orderId,
        method: input.payment.method,
        amountCents,
        note: input.payment.note ?? "POS payment",
        tx,
      });
      await writeAudit(
        gate.staff,
        {
          action: "pos.payment.post",
          targetType: "Order",
          targetId: result.orderId,
          detail: { paymentId: payment.id, method: input.payment.method, amountCents },
        },
        tx
      );
      const finalized = await finalizeOrder(result.orderId, gate.staff.realUser.id, tx);
      await writeAudit(
        gate.staff,
        {
          action: "pos.checkout",
          targetType: "Order",
          targetId: result.orderId,
          detail: { orderNumber: finalized.orderNumber, totalCents: result.totalCents, method: input.payment.method },
        },
        tx
      );
      return finalized.orderNumber;
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Finalize failed" },
      { status: 409 }
    );
  }
  await completeDraft(draft.id, false);

  return Response.json({
    ok: true,
    orderId: result.orderId,
    orderNumber,
    totalCents: result.totalCents,
    paidCents: amountCents,
  });
}
