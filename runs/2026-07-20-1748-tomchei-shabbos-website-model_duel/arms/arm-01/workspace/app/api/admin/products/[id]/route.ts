import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { wouldCreateReplacementCycle } from "@/lib/repeat";

const updateProductSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z.string().max(60).nullish(),
  description: z.string().max(2000).nullish(),
  basePriceCents: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  imageId: z.string().nullish(),
  // Replacement link (R-148): points a retired product at its successor.
  replacementId: z.string().nullish(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("catalog.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = updateProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  if (parsed.data.replacementId === id) {
    return Response.json({ error: "A product cannot replace itself" }, { status: 400 });
  }

  const product = await db.product.findUnique({ where: { id } });
  if (!product) return Response.json({ error: "Product not found" }, { status: 404 });

  if (parsed.data.imageId) {
    const image = await db.mediaAsset.findUnique({ where: { id: parsed.data.imageId }, select: { id: true } });
    if (!image) return Response.json({ error: "Image not found" }, { status: 400 });
  }
  if (parsed.data.replacementId) {
    const replacement = await db.product.findUnique({
      where: { id: parsed.data.replacementId },
      select: { isActive: true },
    });
    if (!replacement) return Response.json({ error: "Replacement product not found" }, { status: 400 });
    // R-048/G-013: links may cross seasons (this year's item → next year's item);
    // they must point at a sellable product and never close a loop.
    if (!replacement.isActive) {
      return Response.json({ error: "Replacement must be an active product" }, { status: 400 });
    }
    const chainProducts = await db.product.findMany({
      select: { id: true, seasonId: true, isActive: true, replacementId: true },
    });
    if (wouldCreateReplacementCycle(id, parsed.data.replacementId, new Map(chainProducts.map((row) => [row.id, row])))) {
      return Response.json({ error: "That replacement would create a loop back to this product" }, { status: 400 });
    }
  }

  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: parsed.data });
    await writeAudit(
      gate.staff,
      { action: "catalog.product.update", targetType: "Product", targetId: id, detail: parsed.data },
      tx
    );
  });
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("catalog.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const orderLineCount = await db.orderLine.count({ where: { productId: id } });
  if (orderLineCount > 0) {
    return Response.json(
      { error: "This product has orders against it. Deactivate it instead of deleting." },
      { status: 409 }
    );
  }

  await db.$transaction(async (tx) => {
    await tx.inventoryItem.deleteMany({ where: { productId: id } });
    await tx.productOption.deleteMany({ where: { productId: id } });
    await tx.product.updateMany({ where: { replacementId: id }, data: { replacementId: null } });
    await tx.product.delete({ where: { id } });
    await writeAudit(gate.staff, { action: "catalog.product.delete", targetType: "Product", targetId: id }, tx);
  });
  return Response.json({ ok: true });
}
