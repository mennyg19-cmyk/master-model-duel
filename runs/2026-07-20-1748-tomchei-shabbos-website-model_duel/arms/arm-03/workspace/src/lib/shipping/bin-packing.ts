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

const FALLBACK_BOX: ShippoParcel = {
  lengthIn: 12,
  widthIn: 9,
  heightIn: 6,
  weightOz: 48,
};

/** One Shippo parcel per bin-packed box (multi-box = multi-parcel quote). */
export function planToParcels(plan: ShipmentPlan, fallback: ShippoParcel = FALLBACK_BOX): ShippoParcel[] {
  if (plan.boxes.length === 0) return [fallback];
  return plan.boxes.map((box) => ({
    lengthIn: box.lengthIn,
    widthIn: box.widthIn,
    heightIn: box.heightIn,
    weightOz: Math.max(1, Math.round(box.weightOz)),
  }));
}

export function planToParcel(plan: ShipmentPlan, fallback: ShippoParcel): ShippoParcel {
  return planToParcels(plan, fallback)[0]!;
}

/** Shared resolver: pack items → parcels for checkout charge and label buy. */
export async function resolveParcelsForItems(items: PackableItem[]): Promise<{
  plan: ShipmentPlan;
  parcels: ShippoParcel[];
}> {
  const boxTypes = await loadActiveBoxTypes();
  const plan = packItems(items, boxTypes);
  const weightOz = Math.max(
    1,
    Math.round(items.reduce((sum, item) => sum + item.weightOz * item.quantity, 0)),
  );
  const fallback: ShippoParcel = { ...FALLBACK_BOX, weightOz };
  return { plan, parcels: planToParcels(plan, fallback) };
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

/** Compute bin-pack plan without persisting (planning must not write on quote failure). */
export async function computePackageShipmentPlan(packageId: string): Promise<{
  plan: ShipmentPlan;
  items: PackableItem[];
}> {
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
  return { plan: packItems(items, boxTypes), items };
}

/** Persist plan after a successful label purchase (or explicit admin replan). */
export async function persistPackageShipmentPlan(
  packageId: string,
  plan: ShipmentPlan,
): Promise<ShipmentPlan> {
  await db.package.update({
    where: { id: packageId },
    data: { shipmentPlan: plan },
  });
  return plan;
}

/** @deprecated Prefer computePackageShipmentPlan + persist on success. */
export async function planPackageShipment(packageId: string): Promise<ShipmentPlan> {
  const { plan } = await computePackageShipmentPlan(packageId);
  return persistPackageShipmentPlan(packageId, plan);
}
