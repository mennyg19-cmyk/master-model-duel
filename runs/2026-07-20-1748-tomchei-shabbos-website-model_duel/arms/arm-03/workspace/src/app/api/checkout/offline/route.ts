import { NextResponse } from "next/server";
import { z } from "zod";
import { PaymentMethod } from "@prisma/client";
import { apiErrorResponse } from "@/lib/api-error";
import { AuthError, requirePermission } from "@/lib/auth";
import { assertCanMutateDraft } from "@/lib/orders/draft-access";
import { prepareCheckout } from "@/lib/checkout/session";
import {
  assertOfflinePaymentStaffOnly,
  postOfflinePayment,
  voidPayment,
} from "@/lib/payments/offline";
import { db } from "@/lib/db";

const postSchema = z.object({
  draftRef: z.string().min(1),
  method: z.enum(["CASH", "CHECK"]),
  amountCents: z.number().int().positive(),
  reference: z.string().max(200).optional(),
  recipients: z
    .array(
      z.object({
        lineIds: z.array(z.string()).min(1),
        fulfillmentMethodCode: z.string().min(1),
        greeting: z.string().max(500).nullable().optional(),
        purimDay: z.string().nullable().optional(),
      }),
    )
    .optional(),
  greetingDefault: z.string().max(500).optional(),
});

const voidSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

/** Staff-only cash/check POS (R-127). Public callers must be rejected. */
export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    assertOfflinePaymentStaffOnly(true);

    const body = postSchema.parse(await request.json());
    const { order } = await assertCanMutateDraft(body.draftRef, request);

    if (body.recipients?.length) {
      const prepared = await prepareCheckout({
        orderId: order.id,
        recipients: body.recipients,
        greetingDefault: body.greetingDefault,
      });
      if (!prepared.ok) {
        return NextResponse.json({ ok: false, error: prepared.publicMessage }, { status: 409 });
      }
      if (prepared.value.conflicts.length) {
        return NextResponse.json({
          ok: false,
          conflicts: prepared.value.conflicts,
        }, { status: 409 });
      }
    }

    const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    if (fresh.expectedTotalCents == null) {
      // Capture snapshot totals from current lines/fees via prepare with existing methods.
      const lines = await db.orderLine.findMany({
        where: { orderId: order.id },
        include: { fulfillmentMethod: true },
      });
      const byMethod = new Map<string, string[]>();
      for (const line of lines) {
        const code = line.fulfillmentMethod?.code;
        if (!code) {
          return NextResponse.json(
            { ok: false, error: "Set fulfillment methods before POS payment." },
            { status: 409 },
          );
        }
        const list = byMethod.get(code) ?? [];
        list.push(line.id);
        byMethod.set(code, list);
      }
      const prepared = await prepareCheckout({
        orderId: order.id,
        recipients: [...byMethod.entries()].map(([fulfillmentMethodCode, lineIds]) => ({
          fulfillmentMethodCode,
          lineIds,
        })),
        greetingDefault: body.greetingDefault,
      });
      if (!prepared.ok || prepared.value.conflicts.length) {
        return NextResponse.json({
          ok: false,
          error: prepared.ok ? "Validation failed" : prepared.publicMessage,
          conflicts: prepared.ok ? prepared.value.conflicts : undefined,
        }, { status: 409 });
      }
    }

    const expected = (
      await db.order.findUniqueOrThrow({ where: { id: order.id } })
    ).expectedTotalCents;
    if (expected != null && body.amountCents !== expected) {
      return NextResponse.json(
        {
          ok: false,
          error: `Amount ${body.amountCents}¢ does not match expected total ${expected}¢`,
        },
        { status: 409 },
      );
    }

    const result = await postOfflinePayment({
      orderId: order.id,
      method: body.method as PaymentMethod,
      amountCents: body.amountCents,
      reference: body.reference,
      staffId: staff.effectiveStaff.id,
      finalizeIfDraft: true,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      payment: result.value.payment,
      orderStatus: result.value.orderStatus,
      paymentStatus: result.value.paymentStatus,
    });
  } catch (error) {
    if (error instanceof AuthError) return apiErrorResponse(error);
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    assertOfflinePaymentStaffOnly(true);
    const body = voidSchema.parse(await request.json());
    const result = await voidPayment({
      paymentId: body.paymentId,
      staffId: staff.effectiveStaff.id,
      reason: body.reason,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      payment: result.value.payment,
      paymentStatus: result.value.paymentStatus,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
