import type { ParcelSpec } from './provider';

/**
 * Which stocked box a package goes in, and how many of them it takes (R-081).
 *
 * Volume and weight, not a three-dimensional fit: the org ships small food
 * boxes into standard cartons, and a real packing solver would be a week of
 * work to save nothing. The fill factor is the honest part — a carton is never
 * packed to its geometric volume, so 80% of it is what counts as usable.
 */
const FILL_FACTOR = 0.8;

/** What an item with no measurements is assumed to be, so a quote is never blocked. */
const ASSUMED_ITEM = { lengthMm: 200, widthMm: 150, heightMm: 100, weightGrams: 900 };

export type BoxType = {
  id: string;
  name: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  maxWeightGrams: number;
};

export type PackableItem = {
  quantity: number;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightGrams: number | null;
};

export type PlannedParcel = ParcelSpec & { boxType: BoxType; unitCount: number };

type Unit = { volumeMm3: number; weightGrams: number };

export function usableVolumeMm3(box: BoxType): number {
  return Math.floor(box.lengthMm * box.widthMm * box.heightMm * FILL_FACTOR);
}

/**
 * Plans the parcels one package will be handed over as.
 *
 * The smallest box everything fits in wins. When nothing fits, the largest box
 * is filled repeatedly with the heaviest items first — the arrangement a person
 * at the packing table arrives at, and one that gives the same answer every
 * time it is asked, which matters because the quote and the label have to agree.
 */
export function planParcels(items: PackableItem[], boxTypes: BoxType[]): PlannedParcel[] {
  if (boxTypes.length === 0) {
    throw new Error('Shipments cannot be planned before at least one box type is stocked.');
  }

  const units = expandUnits(items);
  if (units.length === 0) return [];

  const sorted = [...boxTypes].sort((left, right) => usableVolumeMm3(left) - usableVolumeMm3(right));
  const totals = {
    volumeMm3: units.reduce((total, unit) => total + unit.volumeMm3, 0),
    weightGrams: units.reduce((total, unit) => total + unit.weightGrams, 0),
  };

  const single = sorted.find(
    (box) => totals.volumeMm3 <= usableVolumeMm3(box) && totals.weightGrams <= box.maxWeightGrams,
  );

  if (single) return [parcelOf(single, units)];

  return fillLargestBoxes(units, sorted[sorted.length - 1]);
}

function expandUnits(items: PackableItem[]): Unit[] {
  const units: Unit[] = [];

  for (const item of items) {
    const lengthMm = item.lengthMm ?? ASSUMED_ITEM.lengthMm;
    const widthMm = item.widthMm ?? ASSUMED_ITEM.widthMm;
    const heightMm = item.heightMm ?? ASSUMED_ITEM.heightMm;
    const weightGrams = item.weightGrams ?? ASSUMED_ITEM.weightGrams;

    for (let copy = 0; copy < item.quantity; copy += 1) {
      units.push({ volumeMm3: lengthMm * widthMm * heightMm, weightGrams });
    }
  }

  return units;
}

/**
 * Heaviest first into copies of the biggest carton. An item that does not fit
 * an empty carton on its own still gets one: refusing to plan it would leave
 * the box unquotable and unshippable, and the packing table would rather be
 * told the carton is over-full than told nothing.
 */
function fillLargestBoxes(units: Unit[], box: BoxType): PlannedParcel[] {
  const capacity = usableVolumeMm3(box);
  const parcels: Unit[][] = [];
  let current: Unit[] = [];
  let volume = 0;
  let weight = 0;

  for (const unit of [...units].sort((left, right) => right.weightGrams - left.weightGrams)) {
    const overVolume = volume + unit.volumeMm3 > capacity;
    const overWeight = weight + unit.weightGrams > box.maxWeightGrams;

    if (current.length > 0 && (overVolume || overWeight)) {
      parcels.push(current);
      current = [];
      volume = 0;
      weight = 0;
    }

    current.push(unit);
    volume += unit.volumeMm3;
    weight += unit.weightGrams;
  }

  if (current.length > 0) parcels.push(current);

  return parcels.map((contents) => parcelOf(box, contents));
}

function parcelOf(box: BoxType, units: Unit[]): PlannedParcel {
  return {
    boxType: box,
    unitCount: units.length,
    lengthMm: box.lengthMm,
    widthMm: box.widthMm,
    heightMm: box.heightMm,
    weightGrams: units.reduce((total, unit) => total + unit.weightGrams, 0),
  };
}
