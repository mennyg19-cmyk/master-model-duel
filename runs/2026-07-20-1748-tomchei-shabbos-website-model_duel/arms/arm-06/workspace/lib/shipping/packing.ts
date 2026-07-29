import { DomainRuleError } from "@/lib/errors";

// R-081: shipment planning + bin packing against package types and boxes.
// Order lines become pack items (product's own dims/weight; a product without
// them falls back to the LARGEST active package type — never under-declare),
// then best-fit-decreasing fills the org's shipment boxes (largest unit
// first, smallest open parcel that still fits). Rate quotes ship the
// resulting parcel list; overflow becomes multiple parcels and carriers rate
// the whole set.

export interface PackItem {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
  qty: number;
}

export interface BoxSpec {
  name: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  tareWeightGrams: number;
}

export interface Parcel extends BoxSpec {
  /** Gross weight the carrier rates: box tare + contents. */
  weightGrams: number;
  itemCount: number;
}

// Aggregate fill headroom: real 3D layout is overkill for a rate quote, so a
// parcel accepts items until 85% of box volume is spoken for. The sorted-dim
// check still guarantees no single item exceeds the box it lands in.
const FILL_EFFICIENCY = 0.85;

function volumeMm3(spec: { lengthMm: number; widthMm: number; heightMm: number }): number {
  return spec.lengthMm * spec.widthMm * spec.heightMm;
}

function sortedDims(spec: { lengthMm: number; widthMm: number; heightMm: number }): number[] {
  return [spec.lengthMm, spec.widthMm, spec.heightMm].sort((a, b) => a - b);
}

function fitsDimensionally(item: PackItem, box: BoxSpec): boolean {
  const itemDims = sortedDims(item);
  const boxDims = sortedDims(box);
  return itemDims.every((dim, index) => dim <= boxDims[index]);
}

export function planParcels(items: PackItem[], boxes: BoxSpec[]): Parcel[] {
  if (boxes.length === 0) {
    throw new DomainRuleError("No active shipment boxes configured; expected at least one box to plan parcels");
  }
  const units = items
    .flatMap((item) => Array.from({ length: Math.max(0, Math.floor(item.qty)) }, () => ({ ...item, qty: 1 })))
    .sort((a, b) => volumeMm3(b) - volumeMm3(a));
  if (units.length === 0) {
    throw new DomainRuleError("Nothing to pack; expected at least one unit to plan a shipment");
  }
  const boxesAsc = [...boxes].sort((a, b) => volumeMm3(a) - volumeMm3(b));

  interface OpenParcel {
    box: BoxSpec;
    usedVolume: number;
    weightGrams: number;
    itemCount: number;
  }
  const parcels: OpenParcel[] = [];

  for (const unit of units) {
    const unitVolume = volumeMm3(unit);
    // Best-fit among open parcels: the smallest box that still takes the unit
    // — first-fit would strand small items in an oversized box and over-rate
    // the parcel.
    let target: OpenParcel | undefined;
    for (const parcel of parcels) {
      if (!fitsDimensionally(unit, parcel.box)) continue;
      if (parcel.usedVolume + unitVolume > volumeMm3(parcel.box) * FILL_EFFICIENCY) continue;
      if (!target || volumeMm3(parcel.box) < volumeMm3(target.box)) target = parcel;
    }
    if (target) {
      target.usedVolume += unitVolume;
      target.weightGrams += unit.weightGrams;
      target.itemCount += 1;
      continue;
    }
    const box = boxesAsc.find((candidate) => fitsDimensionally(unit, candidate) && unitVolume <= volumeMm3(candidate) * FILL_EFFICIENCY);
    if (!box) {
      throw new DomainRuleError(
        `An item ${unit.lengthMm}x${unit.widthMm}x${unit.heightMm}mm fits no active shipment box; add a larger box before buying labels`,
      );
    }
    parcels.push({ box, usedVolume: unitVolume, weightGrams: box.tareWeightGrams + unit.weightGrams, itemCount: 1 });
  }

  return parcels
    .map((parcel) => ({ ...parcel.box, weightGrams: parcel.weightGrams, itemCount: parcel.itemCount }))
    .sort((a, b) => volumeMm3(b) - volumeMm3(a));
}
