import { db } from "@/lib/db";

export async function getCurrentSeason() {
  const currentSeasonSetting = await db.appSetting.findUnique({
    where: { key: "current-season-id" },
  });
  const currentSeasonId =
    typeof currentSeasonSetting?.value === "string"
      ? currentSeasonSetting.value
      : undefined;
  return db.season.findFirst({
    where: currentSeasonId ? { id: currentSeasonId } : undefined,
    orderBy: { year: "desc" },
    include: {
      packageTypes: { where: { isActive: true }, orderBy: { name: "asc" } },
      pickupLocations: { orderBy: { name: "asc" } },
      products: {
        where: { kind: "PACKAGE", isActive: true },
        orderBy: { name: "asc" },
        include: {
          options: { where: { isActive: true } },
          inventoryItem: true,
          allowedAddOns: {
            include: { addOn: { include: { addOnInventoryItem: true } } },
          },
        },
      },
    },
  });
}

export async function getArchivedSeasons() {
  return db.season.findMany({
    where: { status: "CLOSED" },
    orderBy: { year: "desc" },
    include: {
      products: {
        where: { kind: "PACKAGE", isActive: true },
        orderBy: { name: "asc" },
      },
    },
  });
}

export function getAvailableQuantity(product: {
  tracksInventory: boolean;
  inventoryItem: { onHand: number; reserved: number } | null;
}) {
  if (!product.tracksInventory) {
    return null;
  }
  return Math.max(
    0,
    (product.inventoryItem?.onHand ?? 0) -
      (product.inventoryItem?.reserved ?? 0),
  );
}
