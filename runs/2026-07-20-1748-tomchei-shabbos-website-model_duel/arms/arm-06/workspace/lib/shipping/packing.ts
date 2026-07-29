import { DomainRuleError } from "@/lib/errors";

// R-081: shipment planning + bin packing against package types and boxes.
// Order lines become pack items (product's own dims/weight; a product without
// them falls back to the LARGEST active package type — never under-declare),
// then first-fit-decreasing fills the org's shipment boxes. Rate quotes ship
// the resulting parcel list; overflow becomes multiple parcels and carriers
// rate the whole set.

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
    const target = parcels.find(
      (parcel) => fitsDimensionally(unit, parcel.box) && parcel.usedVolume + unitVolume <= volumeMm3(parcel.box) * FILL_EFFICIENCY,
    );
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
