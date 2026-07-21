import { test } from "node:test";
import assert from "node:assert/strict";
import { packageGroupingKey, groupByPackageKey } from "../lib/domain/grouping";

const baseLine = {
  recipientName: "Rivka Friedman",
  addressLine1: "12 Main St",
  addressLine2: null,
  city: "Lakewood",
  state: "NJ",
  zip: "08701",
  fulfillmentMethodId: "method-1",
  greeting: "A freilichen Purim!",
};

test("same recipient/address/method/greeting merges into one package", () => {
  const groups = groupByPackageKey([{ ...baseLine }, { ...baseLine }]);
  assert.equal(groups.size, 1);
  assert.equal([...groups.values()][0].length, 2);
});

test("key normalizes case and extra whitespace", () => {
  const shoutyKey = packageGroupingKey({
    ...baseLine,
    recipientName: "  RIVKA   FRIEDMAN ",
    addressLine1: "12  MAIN st",
  });
  assert.equal(shoutyKey, packageGroupingKey(baseLine));
});

test("differing greeting splits into separate packages", () => {
  const groups = groupByPackageKey([
    { ...baseLine },
    { ...baseLine, greeting: "Happy Purim from the Cohens" },
  ]);
  assert.equal(groups.size, 2);
});

test("differing address, method, or recipient each split", () => {
  const groups = groupByPackageKey([
    { ...baseLine },
    { ...baseLine, addressLine1: "14 Main St" },
    { ...baseLine, fulfillmentMethodId: "method-2" },
    { ...baseLine, recipientName: "Moshe Friedman" },
  ]);
  assert.equal(groups.size, 4);
});
