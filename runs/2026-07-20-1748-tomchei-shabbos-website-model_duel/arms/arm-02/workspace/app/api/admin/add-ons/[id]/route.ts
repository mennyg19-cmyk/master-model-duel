import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

const updateAddOnSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  priceCents: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  restrictedToProductIds: z.array(z.string()).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("catalog.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = updateAddOnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const addOn = await db.addOn.findUnique({ where: { id } });
  if (!addOn) return Response.json({ error: "Add-on not found" }, { status: 404 });

  const { restrictedToProductIds, ...fields } = parsed.data;
  await db.$transaction(async (tx) => {
    await tx.addOn.update({ where: { id }, data: fields });
    if (restrictedToProductIds) {
      await tx.addOnRestriction.deleteMany({ where: { addOnId: id } });
      await tx.addOnRestriction.createMany({
        data: restrictedToProductIds.map((productId) => ({ addOnId: id, productId })),
      });
    }
    await writeAudit(
      gate.staff,
      { action: "catalog.addon.update", targetType: "AddOn", targetId: id, detail: parsed.data },
      tx
    );
  });
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("catalog.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const usageCount = await db.orderLineAddOn.count({ where: { addOnId: id } });
  if (usageCount > 0) {
    return Response.json(
      { error: "This add-on is on existing orders. Deactivate it instead of deleting." },
      { status: 409 }
    );
  }

  await db.$transaction(async (tx) => {
    await tx.inventoryItem.deleteMany({ where: { addOnId: id } });
    await tx.addOnRestriction.deleteMany({ where: { addOnId: id } });
    await tx.addOn.delete({ where: { id } });
    await writeAudit(gate.staff, { action: "catalog.addon.delete", targetType: "AddOn", targetId: id }, tx);
  });
  return Response.json({ ok: true });
}
