import { test } from "node:test";
import assert from "node:assert/strict";
import { planParcels, type BoxSpec, type PackItem } from "../lib/shipping/bin-packing";

const boxes: BoxSpec[] = [
  { name: "Small", lengthCm: 35, widthCm: 35, heightCm: 30, weightGrams: 250 },
  { name: "Large", lengthCm: 60, widthCm: 50, heightCm: 45, weightGrams: 600 },
];

const basket = (quantity: number): PackItem => ({
  name: "Classic Basket",
  quantity,
  lengthCm: 30,
  widthCm: 30,
  heightCm: 25,
  weightGrams: 1500,
});

test("one basket packs into the smallest fitting box, weight includes tare", () => {
  const parcels = planParcels([basket(1)], boxes);
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0].boxName, "Small");
  assert.equal(parcels[0].weightGrams, 1500 + 250);
});

test("overflow opens additional parcels instead of overstuffing", () => {
  const largeOnly = boxes.filter((box) => box.name === "Large");
  const parcels = planParcels([basket(6)], largeOnly);
  // 6 × 22500cm³ exceeds one Large at 85% usable volume -> 2 parcels, no unit dropped.
  assert.equal(parcels.length, 2);
  assert.equal(
    parcels.reduce((sum, parcel) => sum + parcel.items.length, 0),
    6
  );
});

test("no configured boxes falls back to the default parcel", () => {
  const parcels = planParcels([basket(1)], []);
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0].boxName, "Standard parcel");
});

test("missing dims use the standard-basket defaults; oversized items ship as their own parcel", () => {
  const noDims: PackItem = { name: "Mystery", quantity: 1, lengthCm: null, widthCm: null, heightCm: null, weightGrams: null };
  const parcels = planParcels([noDims], boxes);
  assert.equal(parcels.length, 1);
  assert.ok(parcels[0].weightGrams > 0);

  const oversized: PackItem = { name: "Grandfather clock", quantity: 1, lengthCm: 200, widthCm: 60, heightCm: 60, weightGrams: 30000 };
  const odd = planParcels([oversized], boxes);
  assert.equal(odd.length, 1);
  assert.match(odd[0].boxName, /Oversized/);
});
