import assert from "node:assert/strict";
import test from "node:test";
import { planShipment, selectShippingMargin } from "../src/domain/shipping";

test("shipping margin charges highest and purchases cheapest eligible rate", () => {
  const now = new Date(Date.now() + 60_000);
  const margin = selectShippingMargin([
    {
      id: "fedex-high",
      carrier: "fedex",
      serviceCode: "ground",
      serviceName: "FedEx Ground",
      amountCents: 2450,
      currency: "usd",
      expiresAt: now,
    },
    {
      id: "ups-low",
      carrier: "ups",
      serviceCode: "ground",
      serviceName: "UPS Ground",
      amountCents: 1815,
      currency: "usd",
      expiresAt: now,
    },
  ]);
  assert.equal(margin.chargedCents, 2450);
  assert.equal(margin.purchasedCents, 1815);
  assert.equal(margin.marginCents, 635);
  assert.equal(margin.purchasedRate.id, "ups-low");
});

test("shipment planner uses another box when volume is full", () => {
  const planned = planShipment(
    [
      {
        quantity: 2,
        widthMm: 100,
        heightMm: 100,
        depthMm: 100,
        weightGrams: 500,
      },
    ],
    [
      {
        id: "box",
        innerWidthMm: 100,
        innerHeightMm: 100,
        innerDepthMm: 100,
        maxWeightGrams: 600,
      },
    ],
  );
  assert.equal(planned.length, 2);
  assert.deepEqual(
    planned.map((box) => box.weightGrams),
    [500, 500],
  );
});
