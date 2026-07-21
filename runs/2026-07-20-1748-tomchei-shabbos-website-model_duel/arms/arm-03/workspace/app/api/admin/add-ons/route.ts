import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { validateRestrictedProductIds, validateSeasonExists } from "@/lib/catalog-validation";

export async function GET(request: Request) {
  const gate = await requirePermissionApi("catalog.manage");
  if ("response" in gate) return gate.response;

  const seasonId = new URL(request.url).searchParams.get("seasonId");
  if (!seasonId) return Response.json({ error: "seasonId query param is required" }, { status: 400 });

  const addOns = await db.addOn.findMany({
    where: { seasonId },
    include: { restrictions: { include: { product: { select: { id: true, name: true } } } } },
    orderBy: { name: "asc" },
  });
  return Response.json(addOns);
}

const createAddOnSchema = z.object({
  seasonId: z.string().min(1),
  name: z.string().min(1).max(120),
  priceCents: z.number().int().min(0),
  trackInventory: z.boolean().default(false),
  // Empty = unrestricted; otherwise the add-on is allowed only on these products (R-147).
  restrictedToProductIds: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  const gate = await requirePermissionApi("catalog.manage");
  if ("response" in gate) return gate.response;

  const parsed = createAddOnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const seasonError = await validateSeasonExists(parsed.data.seasonId);
  if (seasonError) return Response.json({ error: seasonError }, { status: 404 });
  const restrictionError = await validateRestrictedProductIds(
    parsed.data.restrictedToProductIds,
    parsed.data.seasonId
  );
  if (restrictionError) return Response.json({ error: restrictionError }, { status: 400 });

  const duplicate = await db.addOn.findUnique({
    where: { seasonId_name: { seasonId: parsed.data.seasonId, name: parsed.data.name } },
  });
  if (duplicate) {
    return Response.json({ error: `Add-on "${parsed.data.name}" already exists in this season` }, { status: 409 });
  }

  const created = await db.$transaction(async (tx) => {
    const addOn = await tx.addOn.create({
      data: {
        seasonId: parsed.data.seasonId,
        name: parsed.data.name,
        priceCents: parsed.data.priceCents,
        trackInventory: parsed.data.trackInventory,
        restrictions: {
          create: parsed.data.restrictedToProductIds.map((productId) => ({ productId })),
        },
      },
    });
    if (parsed.data.trackInventory) {
      await tx.inventoryItem.create({ data: { addOnId: addOn.id } });
    }
    await writeAudit(
      gate.staff,
      { action: "catalog.addon.create", targetType: "AddOn", targetId: addOn.id, detail: { name: addOn.name } },
      tx
    );
    return addOn;
  });
  return Response.json({ ok: true, id: created.id }, { status: 201 });
}
