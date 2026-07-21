import { ProductKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiErrorResponse } from "@/lib/api-error";
import { assertInventoryTargetXor } from "@/lib/inventory/target-xor";

const productSchema = z.object({
  id: z.string().optional(),
  seasonId: z.string().min(1),
  sku: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80),
  kind: z.nativeEnum(ProductKind).default(ProductKind.PACKAGE),
  category: z.string().max(60).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  basePriceCents: z.number().int().nonnegative(),
  tracksInventory: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  primaryImageUrl: z.string().nullable().optional(),
  mediaAssetId: z.string().nullable().optional(),
  onHand: z.number().int().nonnegative().optional(),
  options: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        priceAdjustmentCents: z.number().int(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .optional(),
  replacementToProductIds: z.array(z.string()).optional(),
  allowedAddOnIds: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    await requirePermission("settings.read");
    const products = await db.product.findMany({
      where: { isActive: true },
      include: {
        season: true,
        options: { orderBy: { sortOrder: "asc" } },
        inventory: true,
        mediaAsset: true,
        replacementsFrom: true,
        allowedAddOns: true,
      },
      orderBy: [{ seasonId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    const seasons = await db.season.findMany({ orderBy: { year: "desc" } });
    return NextResponse.json({ ok: true, products, seasons });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = productSchema.parse(await request.json());

    const product = await db.$transaction(async (tx) => {
      const data = {
        seasonId: body.seasonId,
        sku: body.sku,
        name: body.name,
        slug: body.slug,
        kind: body.kind,
        category: body.category ?? null,
        description: body.description ?? null,
        basePriceCents: body.basePriceCents,
        tracksInventory: body.tracksInventory ?? true,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
        primaryImageUrl: body.primaryImageUrl ?? null,
        mediaAssetId: body.mediaAssetId ?? null,
      };

      const saved = body.id
        ? await tx.product.update({ where: { id: body.id }, data })
        : await tx.product.create({ data });

      if (body.options) {
        for (const opt of body.options) {
          if (opt.id) {
            await tx.productOption.update({
              where: { id: opt.id },
              data: {
                name: opt.name,
                priceAdjustmentCents: opt.priceAdjustmentCents,
                isActive: opt.isActive ?? true,
                sortOrder: opt.sortOrder ?? 0,
              },
            });
          } else {
            await tx.productOption.create({
              data: {
                productId: saved.id,
                name: opt.name,
                priceAdjustmentCents: opt.priceAdjustmentCents,
                isActive: opt.isActive ?? true,
                sortOrder: opt.sortOrder ?? 0,
              },
            });
          }
        }
      }

      if (body.allowedAddOnIds) {
        await tx.productAddOnAllow.deleteMany({ where: { productId: saved.id } });
        for (const addOnId of body.allowedAddOnIds) {
          await tx.productAddOnAllow.create({ data: { productId: saved.id, addOnId } });
        }
      }

      if (body.replacementToProductIds) {
        await tx.productReplacement.deleteMany({ where: { fromProductId: saved.id } });
        for (const toProductId of body.replacementToProductIds) {
          await tx.productReplacement.create({
            data: { fromProductId: saved.id, toProductId },
          });
        }
      }

      if (body.onHand !== undefined && data.tracksInventory) {
        assertInventoryTargetXor({ productId: saved.id, addOnId: null });
        await tx.inventoryItem.upsert({
          where: { productId: saved.id },
          create: { productId: saved.id, onHand: body.onHand, reserved: 0 },
          update: { onHand: body.onHand },
        });
      }

      return saved;
    });

    await writeAudit({
      action: "PRODUCT_UPSERTED",
      actorId: ctx.effectiveStaff.id,
      meta: { productId: product.id, sku: product.sku },
    });

    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = z.object({ id: z.string().min(1) }).parse(await request.json());
    const product = await db.product.update({
      where: { id: body.id },
      data: { isActive: false },
    });
    await writeAudit({
      action: "PRODUCT_UPSERTED",
      actorId: ctx.effectiveStaff.id,
      meta: { productId: product.id, sku: product.sku, deleted: true },
    });
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
