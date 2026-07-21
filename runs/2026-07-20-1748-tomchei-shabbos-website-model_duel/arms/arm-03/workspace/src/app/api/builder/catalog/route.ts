import { NextResponse } from "next/server";
import { SeasonStatus } from "@prisma/client";
import { apiErrorResponse } from "@/lib/api-error";
import { db } from "@/lib/db";
import { availableUnits } from "@/lib/inventory/reserve";
import { getCurrentSeason, isStoreOpen } from "@/lib/storefront/season";

/** Builder catalog: live stock, options, restricted add-ons. */
export async function GET() {
  try {
    const season = await getCurrentSeason();
    if (!season || !isStoreOpen(season)) {
      return NextResponse.json({ ok: true, storeOpen: false, products: [], addOns: [] });
    }

    const products = await db.product.findMany({
      where: { seasonId: season.id, isActive: true, season: { status: SeasonStatus.OPEN } },
      include: {
        inventory: true,
        options: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
        allowedAddOns: {
          include: { addOn: true },
        },
        mediaAsset: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({
      ok: true,
      storeOpen: true,
      season: { id: season.id, name: season.name, year: season.year },
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        category: p.category,
        description: p.description,
        basePriceCents: p.basePriceCents,
        tracksInventory: p.tracksInventory,
        primaryImageUrl: p.primaryImageUrl ?? p.mediaAsset?.url ?? null,
        stockAvailable: p.tracksInventory
          ? p.inventory
            ? availableUnits(p.inventory)
            : 0
          : null,
        options: p.options.map((o) => ({
          id: o.id,
          name: o.name,
          priceAdjustmentCents: o.priceAdjustmentCents,
        })),
        allowedAddOns: p.allowedAddOns
          .filter((a) => a.addOn.isActive)
          .map((a) => ({
            id: a.addOn.id,
            name: a.addOn.name,
            sku: a.addOn.sku,
            priceCents: a.addOn.priceCents,
            isRestricted: a.addOn.isRestricted,
          })),
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
