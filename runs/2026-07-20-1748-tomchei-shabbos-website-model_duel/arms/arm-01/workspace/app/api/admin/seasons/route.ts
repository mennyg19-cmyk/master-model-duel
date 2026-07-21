import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

const createSeasonSchema = z.object({
  name: z.string().trim().min(2).max(80),
  // ISO datetimes from the wizard's datetime-local inputs; optional one-shot schedule (UR-008).
  opensAt: z.coerce.date().nullish(),
  closesAt: z.coerce.date().nullish(),
  copyFromSeasonId: z.string().min(1).nullish(),
});

/**
 * New-season setup wizard (R-097). Creates the season CLOSED (opening is the
 * manager switch or the scheduled auto-flip) and optionally copies a prior
 * season's catalog: products with options, add-ons with restrictions, zeroed
 * inventory for tracked items. Copied-from products that have no replacement
 * yet get linked to their new-season copy — that seeding is what makes
 * cross-season repeat chains (R-048, G-013) work without manual mapping.
 */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const parsed = createSeasonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { name, opensAt, closesAt, copyFromSeasonId } = parsed.data;

  if (opensAt && closesAt && closesAt <= opensAt) {
    return Response.json({ error: "The close time must be after the open time" }, { status: 400 });
  }
  const duplicate = await db.season.findUnique({ where: { name } });
  if (duplicate) return Response.json({ error: `A season named "${name}" already exists` }, { status: 409 });

  const sourceProducts = copyFromSeasonId
    ? await db.product.findMany({
        where: { seasonId: copyFromSeasonId },
        include: { options: true },
      })
    : [];
  if (copyFromSeasonId && sourceProducts.length === 0) {
    const sourceExists = await db.season.findUnique({ where: { id: copyFromSeasonId }, select: { id: true } });
    if (!sourceExists) return Response.json({ error: "Season to copy from was not found" }, { status: 404 });
  }
  const sourceAddOns = copyFromSeasonId
    ? await db.addOn.findMany({ where: { seasonId: copyFromSeasonId }, include: { restrictions: true } })
    : [];

  const season = await db.$transaction(async (tx) => {
    const created = await tx.season.create({
      data: { name, status: "CLOSED", opensAt: opensAt ?? null, closesAt: closesAt ?? null },
    });

    const newProductIdByOld = new Map<string, string>();
    for (const source of sourceProducts) {
      const copy = await tx.product.create({
        data: {
          seasonId: created.id,
          name: source.name,
          slug: source.slug,
          category: source.category,
          description: source.description,
          kind: source.kind,
          basePriceCents: source.basePriceCents,
          widthCm: source.widthCm,
          lengthCm: source.lengthCm,
          heightCm: source.heightCm,
          weightGrams: source.weightGrams,
          trackInventory: source.trackInventory,
          isActive: source.isActive,
          imageId: source.imageId,
          options: {
            create: source.options.map((option) => ({
              name: option.name,
              priceAdjustmentCents: option.priceAdjustmentCents,
              isActive: option.isActive,
            })),
          },
        },
      });
      newProductIdByOld.set(source.id, copy.id);
      if (source.trackInventory) {
        await tx.inventoryItem.create({ data: { productId: copy.id, quantityOnHand: 0 } });
      }
      // Seed the repeat chain: only when the old product isn't already mapped.
      if (!source.replacementId) {
        await tx.product.update({ where: { id: source.id }, data: { replacementId: copy.id } });
      }
    }

    for (const source of sourceAddOns) {
      const copy = await tx.addOn.create({
        data: {
          seasonId: created.id,
          name: source.name,
          priceCents: source.priceCents,
          trackInventory: source.trackInventory,
          isActive: source.isActive,
          restrictions: {
            create: source.restrictions
              .map((rule) => newProductIdByOld.get(rule.productId))
              .filter((productId): productId is string => Boolean(productId))
              .map((productId) => ({ productId })),
          },
        },
      });
      if (source.trackInventory) {
        await tx.inventoryItem.create({ data: { addOnId: copy.id, quantityOnHand: 0 } });
      }
    }

    await writeAudit(
      gate.staff,
      {
        action: "season.create",
        targetType: "Season",
        targetId: created.id,
        detail: {
          name,
          opensAt: opensAt?.toISOString() ?? null,
          closesAt: closesAt?.toISOString() ?? null,
          copiedFrom: copyFromSeasonId ?? null,
          copiedProducts: sourceProducts.length,
          copiedAddOns: sourceAddOns.length,
        },
      },
      tx
    );
    return created;
  });

  return Response.json({ ok: true, id: season.id }, { status: 201 });
}
