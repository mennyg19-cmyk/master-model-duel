import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMargin } from "../lib/shipping/margin";
import { mockRates, type CarrierRate } from "../lib/shipping/mock-rates";

const rate = (carrier: string, service: string, amountCents: number): CarrierRate => ({
  rateId: `${carrier}|${service}|${amountCents}`,
  carrier,
  service,
  amountCents,
  estimatedDays: 3,
});

test("margin engine: charge highest per-carrier best, buy the cheapest, margin exact (UR-003)", () => {
  const decision = resolveMargin([
    rate("FedEx", "Ground", 900),
    rate("FedEx", "2Day", 2400), // more expensive service on the same carrier is ignored
    rate("UPS", "Ground", 1200),
  ]);
  assert.ok(!("error" in decision));
  assert.equal(decision.chargeCents, 1200);
  assert.equal(decision.buy.carrier, "FedEx");
  assert.equal(decision.buy.amountCents, 900);
  assert.equal(decision.marginCents, 300);
  assert.equal(decision.perCarrierBest.length, 2);
});

test("margin flips with the cheaper carrier, never negative", () => {
  const decision = resolveMargin([rate("FedEx", "Ground", 1500), rate("UPS", "Ground", 1100), rate("USPS", "Priority", 1900)]);
  assert.ok(!("error" in decision));
  assert.equal(decision.buy.carrier, "UPS");
  assert.equal(decision.chargeCents, 1900);
  assert.equal(decision.marginCents, 800);
});

test("single-carrier quotes still work — zero margin", () => {
  const decision = resolveMargin([rate("FedEx", "Ground", 1000)]);
  assert.ok(!("error" in decision));
  assert.equal(decision.chargeCents, 1000);
  assert.equal(decision.marginCents, 0);
});

test("no rates is an error, not a guess", () => {
  const decision = resolveMargin([]);
  assert.ok("error" in decision);
});

test("mock fixtures put the surcharge on opposite carriers by ZIP parity", () => {
  const parcel = [{ lengthCm: 40, widthCm: 40, heightCm: 40, weightGrams: 3000 }];
  const to = (zip: string) => ({ name: "T", line1: "1 Test St", city: "X", state: "NY", zip });

  const evenZip = resolveMargin(mockRates(to("10002"), parcel));
  const oddZip = resolveMargin(mockRates(to("10001"), parcel));
  assert.ok(!("error" in evenZip) && !("error" in oddZip));
  // Even ZIP surcharges FedEx (UPS or USPS wins the buy); odd surcharges UPS.
  assert.notEqual(evenZip.buy.carrier, "FedEx");
  assert.notEqual(oddZip.buy.carrier, "UPS");
  assert.ok(evenZip.marginCents > 0);
  assert.ok(oddZip.marginCents > 0);
});

test("mock USPS drops out for heavy parcels (eligibility)", () => {
  const heavy = [{ lengthCm: 50, widthCm: 50, heightCm: 50, weightGrams: 9000 }];
  const to = { name: "T", line1: "1 Test St", city: "X", state: "NY", zip: "10001" };
  const carriers = mockRates(to, heavy).map((entry) => entry.carrier);
  assert.deepEqual(carriers.sort(), ["FedEx", "UPS"]);
});
