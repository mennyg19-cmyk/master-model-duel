import type { Parcel } from "@/lib/shipping/shippo";

// Bin packing + shipment planning (R-081): decide how a package's contents
// physically split across the org's configured shipment boxes. First-fit
// decreasing by volume — not optimal, but stable, explainable, and never
// under-ships (anything that fits no configured box gets its own
// dimensions-as-parcel so the carrier still quotes it).

export type PackItem = {
  name: string;
  quantity: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightGrams: number | null;
};

export type BoxSpec = {
  name: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  /** Empty-box weight (tare), added to every parcel packed in it. */
  weightGrams: number | null;
};

export type PlannedParcel = Parcel & {
  boxName: string;
  items: string[];
};

type NormalizedBox = { name: string; lengthCm: number; widthCm: number; heightCm: number; weightGrams: number };

// A gift without dims still has to ship: assume the seeded standard basket.
const DEFAULT_ITEM_DIMS = { lengthCm: 30, widthCm: 30, heightCm: 30, weightGrams: 1500 };
// With no boxes configured, quote one generic parcel per unit.
const DEFAULT_BOX: NormalizedBox = { name: "Standard parcel", lengthCm: 40, widthCm: 40, heightCm: 40, weightGrams: 200 };
// Real boxes never fill 100% — items aren't liquid.
const USABLE_VOLUME_RATIO = 0.85;

type Unit = { name: string; dims: [number, number, number]; volume: number; weightGrams: number };

function sortedDims(length: number, width: number, height: number): [number, number, number] {
  return [length, width, height].sort((a, b) => a - b) as [number, number, number];
}

function unitFits(unit: Unit, box: NormalizedBox): boolean {
  const boxDims = sortedDims(box.lengthCm, box.widthCm, box.heightCm);
  return unit.dims.every((dim, index) => dim <= boxDims[index]);
}

function normalizeBox(box: BoxSpec): NormalizedBox {
  return {
    name: box.name,
    lengthCm: box.lengthCm ?? DEFAULT_BOX.lengthCm,
    widthCm: box.widthCm ?? DEFAULT_BOX.widthCm,
    heightCm: box.heightCm ?? DEFAULT_BOX.heightCm,
    weightGrams: box.weightGrams ?? DEFAULT_BOX.weightGrams,
  };
}

/**
 * Plan parcels for a set of items against the configured boxes.
 * Boxes are tried smallest-first so each opened parcel is the smallest box the
 * next item fits in; items go largest-first (first-fit decreasing).
 */
export function planParcels(items: PackItem[], boxes: BoxSpec[]): PlannedParcel[] {
  const units: Unit[] = items.flatMap((item) => {
    const dims = sortedDims(
      item.lengthCm ?? DEFAULT_ITEM_DIMS.lengthCm,
      item.widthCm ?? DEFAULT_ITEM_DIMS.widthCm,
      item.heightCm ?? DEFAULT_ITEM_DIMS.heightCm
    );
    const unit: Unit = {
      name: item.name,
      dims,
      volume: dims[0] * dims[1] * dims[2],
      weightGrams: item.weightGrams ?? DEFAULT_ITEM_DIMS.weightGrams,
    };
    return Array.from({ length: Math.max(1, item.quantity) }, () => ({ ...unit }));
  });
  if (units.length === 0) return [];
  units.sort((a, b) => b.volume - a.volume);

  const candidateBoxes = (boxes.length > 0 ? boxes.map(normalizeBox) : [DEFAULT_BOX]).sort(
    (a, b) => a.lengthCm * a.widthCm * a.heightCm - b.lengthCm * b.widthCm * b.heightCm
  );

  type OpenParcel = { box: NormalizedBox; usedVolume: number; itemsWeight: number; items: string[] };
  const open: OpenParcel[] = [];

  for (const unit of units) {
    const fitting = open.find(
      (parcel) =>
        unitFits(unit, parcel.box) &&
        parcel.usedVolume + unit.volume <=
          parcel.box.lengthCm * parcel.box.widthCm * parcel.box.heightCm * USABLE_VOLUME_RATIO
    );
    if (fitting) {
      fitting.usedVolume += unit.volume;
      fitting.itemsWeight += unit.weightGrams;
      fitting.items.push(unit.name);
      continue;
    }

    // Smallest configured box the unit fits; oversized items ship as their own
    // dimensions (the carrier prices the odd parcel, we never drop it).
    const box =
      candidateBoxes.find(
        (candidate) =>
          unitFits(unit, candidate) &&
          unit.volume <= candidate.lengthCm * candidate.widthCm * candidate.heightCm * USABLE_VOLUME_RATIO
      ) ?? {
        name: `Oversized (${unit.name})`,
        lengthCm: unit.dims[2],
        widthCm: unit.dims[1],
        heightCm: unit.dims[0],
        weightGrams: DEFAULT_BOX.weightGrams,
      };
    open.push({ box, usedVolume: unit.volume, itemsWeight: unit.weightGrams, items: [unit.name] });
  }

  return open.map((parcel) => ({
    boxName: parcel.box.name,
    lengthCm: parcel.box.lengthCm,
    widthCm: parcel.box.widthCm,
    heightCm: parcel.box.heightCm,
    weightGrams: parcel.itemsWeight + parcel.box.weightGrams,
    items: parcel.items,
  }));
}
