import { db } from "@/lib/db";
import type { ShippoParcel } from "@/lib/shippo/client";

export type PackableItem = {
  id: string;
  sku: string;
  quantity: number;
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export type BoxAssignment = {
  packageTypeCode: string;
  packageTypeId: string;
  label: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightOz: number;
  usedVolume: number;
  itemIds: string[];
};

export type ShipmentPlan = {
  boxes: BoxAssignment[];
  unpackedItemIds: string[];
};

type BoxType = {
  id: string;
  code: string;
  name: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  maxWeightOz: number | null;
};

function volume(l: number, w: number, h: number): number {
  return l * w * h;
}

function itemFits(
  box: BoxType,
  item: PackableItem,
  usedVolume: number,
  usedWeight: number,
): boolean {
  const dimsOk =
    item.lengthIn <= box.lengthIn &&
    item.widthIn <= box.widthIn &&
    item.heightIn <= box.heightIn;
  if (!dimsOk) return false;
  const cap = volume(box.lengthIn, box.widthIn, box.heightIn) * 0.95;
  if (usedVolume + volume(item.lengthIn, item.widthIn, item.heightIn) > cap) return false;
  if (box.maxWeightOz != null && usedWeight + item.weightOz > box.maxWeightOz) return false;
  return true;
}

/** First-fit decreasing into PackageType boxes (R-081). */
export function packItems(items: PackableItem[], boxTypes: BoxType[]): ShipmentPlan {
  const sortedBoxes = [...boxTypes].sort(
    (a, b) => volume(a.lengthIn, a.widthIn, a.heightIn) - volume(b.lengthIn, b.widthIn, b.heightIn),
  );
  const units: PackableItem[] = [];
  for (const item of items) {
    for (let i = 0; i < item.quantity; i += 1) {
      units.push({ ...item, id: `${item.id}#${i}`, quantity: 1 });
    }
  }
  units.sort(
    (a, b) =>
      volume(b.lengthIn, b.widthIn, b.heightIn) - volume(a.lengthIn, a.widthIn, a.heightIn),
  );

  const boxes: BoxAssignment[] = [];
  const unpackedItemIds: string[] = [];

  for (const unit of units) {
    let placed = false;
    for (const open of boxes) {
      const boxType = sortedBoxes.find((b) => b.id === open.packageTypeId);
      if (!boxType) continue;
      if (itemFits(boxType, unit, open.usedVolume, open.weightOz)) {
        open.itemIds.push(unit.id);
        open.weightOz += unit.weightOz;
        open.usedVolume += volume(unit.lengthIn, unit.widthIn, unit.heightIn);
        placed = true;
        break;
      }
    }
    if (placed) continue;

    const fit = sortedBoxes.find((b) => itemFits(b, unit, 0, 0));
    if (!fit) {
      unpackedItemIds.push(unit.id);
      continue;
    }
    boxes.push({
      packageTypeCode: fit.code,
      packageTypeId: fit.id,
      label: fit.name,
      lengthIn: fit.lengthIn,
      widthIn: fit.widthIn,
      heightIn: fit.heightIn,
      weightOz: unit.weightOz,
      usedVolume: volume(unit.lengthIn, unit.widthIn, unit.heightIn),
      itemIds: [unit.id],
    });
  }

  return { boxes, unpackedItemIds };
}

export function planToParcel(plan: ShipmentPlan, fallback: ShippoParcel): ShippoParcel {
  if (plan.boxes.length === 0) return fallback;
  const primary = plan.boxes.reduce((a, b) => (a.weightOz >= b.weightOz ? a : b));
  return {
    lengthIn: primary.lengthIn,
    widthIn: primary.widthIn,
    heightIn: primary.heightIn,
    weightOz: Math.max(1, Math.round(primary.weightOz)),
  };
}

export async function loadActiveBoxTypes(): Promise<BoxType[]> {
  const rows = await db.packageType.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });
  if (rows.length > 0) return rows;
  return [
    {
      id: "fallback-small",
      code: "SMALL",
      name: "Small box",
      lengthIn: 12,
      widthIn: 9,
      heightIn: 6,
      maxWeightOz: 320,
    },
    {
      id: "fallback-med",
      code: "MEDIUM",
      name: "Medium box",
      lengthIn: 18,
      widthIn: 12,
      heightIn: 10,
      maxWeightOz: 640,
    },
  ];
}

export async function planPackageShipment(packageId: string): Promise<ShipmentPlan> {
  const pkg = await db.package.findUniqueOrThrow({
    where: { id: packageId },
    include: {
      items: {
        include: {
          orderLine: {
            include: { product: true },
          },
        },
      },
    },
  });

  const items: PackableItem[] = pkg.items.map((item) => ({
    id: item.id,
    sku: item.orderLine.product.sku,
    quantity: item.quantity,
    weightOz: item.orderLine.product.weightOz ?? 16,
    lengthIn: item.orderLine.product.lengthIn ?? 8,
    widthIn: item.orderLine.product.widthIn ?? 6,
    heightIn: item.orderLine.product.heightIn ?? 4,
  }));

  const boxTypes = await loadActiveBoxTypes();
  const plan = packItems(items, boxTypes);
  await db.package.update({
    where: { id: packageId },
    data: { shipmentPlan: plan },
  });
  return plan;
}
