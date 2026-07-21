import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import {
  createLabelForPackage,
  LabelError,
  voidLabelForPackage,
} from "@/lib/shipping/labels";
import { db } from "@/lib/db";
import { validateAddress } from "@/lib/shippo/client";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), packageId: z.string().min(1) }),
  z.object({ action: z.literal("void"), packageId: z.string().min(1) }),
  z.object({
    action: z.literal("validate"),
    address: z.object({
      name: z.string(),
      street1: z.string(),
      street2: z.string().optional().nullable(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
      country: z.string().optional(),
    }),
  }),
]);

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("admin.access");
    const { id } = await ctx.params;
    const labels = await db.shippingLabel.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "desc" },
      include: {
        package: {
          select: { id: true, recipientName: true, stage: true, postalCode: true },
        },
      },
    });
    return NextResponse.json({ ok: true, labels });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const staff = await requirePermission("admin.access");
    await ctx.params;
    const body = bodySchema.parse(await request.json());

    if (body.action === "validate") {
      const result = await validateAddress(body.address);
      return NextResponse.json({ ok: true, validation: result });
    }

    if (body.action === "create") {
      const result = await createLabelForPackage({
        packageId: body.packageId,
        actorId: staff.effectiveStaff.id,
      });
      return NextResponse.json({
        ok: true,
        label: result.label,
        margin: {
          chargedCents: result.margin.chargedCents,
          purchasedCents: result.margin.purchasedCents,
          marginCents: result.margin.marginCents,
        },
      });
    }

    const result = await voidLabelForPackage({
      packageId: body.packageId,
      actorId: staff.effectiveStaff.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof LabelError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}
