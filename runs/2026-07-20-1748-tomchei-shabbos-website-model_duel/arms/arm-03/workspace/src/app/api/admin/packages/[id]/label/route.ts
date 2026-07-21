import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import {
  createLabelForPackage,
  LabelError,
  refreshTracking,
  voidLabelForPackage,
} from "@/lib/shipping/labels";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("void") }),
  z.object({ action: z.literal("refresh"), labelId: z.string().min(1).optional() }),
]);

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("admin.access");
    const { id } = await ctx.params;
    const labels = await db.shippingLabel.findMany({
      where: { packageId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ ok: true, labels });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const staff = await requirePermission("admin.access");
    const { id } = await ctx.params;
    const body = bodySchema.parse(await request.json());

    if (body.action === "create") {
      const result = await createLabelForPackage({
        packageId: id,
        actorId: staff.effectiveStaff.id,
      });
      return NextResponse.json({
        ok: true,
        label: result.label,
        margin: {
          chargedCents: result.margin.chargedCents,
          purchasedCents: result.margin.purchasedCents,
          marginCents: result.margin.marginCents,
          chargeCarrier: result.margin.chargeRate.carrier,
          buyCarrier: result.margin.buyRate.carrier,
        },
        plan: result.plan,
      });
    }

    if (body.action === "void") {
      const result = await voidLabelForPackage({
        packageId: id,
        actorId: staff.effectiveStaff.id,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const active =
      body.labelId ??
      (
        await db.shippingLabel.findFirst({
          where: { packageId: id, status: "PURCHASED" },
          orderBy: { createdAt: "desc" },
        })
      )?.id;
    if (!active) {
      return NextResponse.json({ ok: false, error: "No label to refresh" }, { status: 404 });
    }
    const updated = await refreshTracking(active, staff.effectiveStaff.id);
    return NextResponse.json({ ok: true, label: updated });
  } catch (error) {
    if (error instanceof LabelError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}
