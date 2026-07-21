import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiErrorResponse } from "@/lib/api-error";
import { assertInventoryTargetXor } from "@/lib/inventory/target-xor";

const schema = z.object({
  id: z.string().optional(),
  sku: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  priceCents: z.number().int().nonnegative(),
  tracksInventory: z.boolean().optional(),
  isRestricted: z.boolean().optional(),
  isActive: z.boolean().optional(),
  onHand: z.number().int().nonnegative().optional(),
});

export async function GET() {
  try {
    await requirePermission("settings.read");
    const addOns = await db.addOn.findMany({
      where: { isActive: true },
      include: { inventory: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ ok: true, addOns });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = schema.parse(await request.json());
    const data = {
      sku: body.sku,
      name: body.name,
      description: body.description ?? null,
      priceCents: body.priceCents,
      tracksInventory: body.tracksInventory ?? true,
      isRestricted: body.isRestricted ?? false,
      isActive: body.isActive ?? true,
    };
    const addOn = body.id
      ? await db.addOn.update({ where: { id: body.id }, data })
      : await db.addOn.create({ data });

    if (body.onHand !== undefined && data.tracksInventory) {
      assertInventoryTargetXor({ productId: null, addOnId: addOn.id });
      await db.inventoryItem.upsert({
        where: { addOnId: addOn.id },
        create: { addOnId: addOn.id, onHand: body.onHand, reserved: 0 },
        update: { onHand: body.onHand },
      });
    }

    await writeAudit({
      action: "ADDON_UPSERTED",
      actorId: ctx.effectiveStaff.id,
      meta: { addOnId: addOn.id, sku: addOn.sku },
    });
    return NextResponse.json({ ok: true, addOn });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = z.object({ id: z.string().min(1) }).parse(await request.json());
    const addOn = await db.addOn.update({
      where: { id: body.id },
      data: { isActive: false },
    });
    await writeAudit({
      action: "ADDON_UPSERTED",
      actorId: ctx.effectiveStaff.id,
      meta: { addOnId: addOn.id, sku: addOn.sku, deleted: true },
    });
    return NextResponse.json({ ok: true, addOn });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
