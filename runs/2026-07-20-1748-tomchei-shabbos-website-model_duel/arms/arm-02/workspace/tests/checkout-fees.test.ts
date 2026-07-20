import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFees, type FeeRuleConfig } from "../lib/checkout/fees";
import type { CheckoutRecipient } from "../lib/checkout/recipients";

const config: FeeRuleConfig = {
  bulkFeePerDestinationCents: 500,
  perPackageFeeCents: 1200,
  shippingPlaceholderCents: 1500,
  deliveryZips: ["08701"],
  purimDayChoices: ["Purim day"],
};

const methods = [
  { id: "bulk", name: "Local Delivery", kind: "BULK_DELIVERY" as const, isActive: true },
  { id: "per", name: "Purim-Day Delivery", kind: "PER_PACKAGE_DELIVERY" as const, isActive: true },
  { id: "pickup", name: "Pickup", kind: "PICKUP" as const, isActive: true },
  { id: "ship", name: "Shipping", kind: "SHIPPING" as const, isActive: true },
];

function recipient(key: string, zip: string, line1 = `${key} street`): CheckoutRecipient {
  return {
    key,
    recipientName: `Recipient ${key}`,
    address: { line1, line2: null, city: "Lakewood", state: "NJ", zip },
    addressBookId: null,
    rememberedGreeting: null,
    lineIds: [key],
  };
}

test("bulk delivery bills one fee per distinct destination", () => {
  const shared = "12 Main St";
  const result = computeFees(
    [recipient("a", "08701", shared), recipient("b", "08701", shared), recipient("c", "08701")],
    [
      { recipientKey: "a", methodId: "bulk" },
      { recipientKey: "b", methodId: "bulk" },
      { recipientKey: "c", methodId: "bulk" },
    ],
    methods,
    config,
    null
  );
  assert.ok(result.ok);
  // a and b share an address -> 2 destinations -> 2 fees
  assert.equal(result.feeLines.length, 2);
  assert.equal(result.feesCents, 1000);
});

test("per-package delivery bills per recipient and requires a day", () => {
  const result = computeFees(
    [recipient("a", "08701"), recipient("b", "08701"), recipient("c", "08701")],
    [
      { recipientKey: "a", methodId: "per" },
      { recipientKey: "b", methodId: "per" },
      { recipientKey: "c", methodId: "per" },
    ],
    methods,
    config,
    "Purim day"
  );
  assert.ok(result.ok);
  assert.equal(result.feeLines.length, 3);
  assert.equal(result.feesCents, 3600);
  assert.ok(result.requiresDeliveryDay);
});

test("per-package delivery hard-blocks out-of-zone zips", () => {
  const result = computeFees(
    [recipient("far", "99999")],
    [{ recipientKey: "far", methodId: "per" }],
    methods,
    config,
    "Purim day"
  );
  assert.ok(!result.ok);
  assert.match(result.errors[0], /outside the delivery area/);
});

test("missing or unlisted delivery day is refused", () => {
  const noDay = computeFees(
    [recipient("a", "08701")],
    [{ recipientKey: "a", methodId: "per" }],
    methods,
    config,
    null
  );
  assert.ok(!noDay.ok);
  assert.match(noDay.errors[0], /delivery day/);

  const badDay = computeFees(
    [recipient("a", "08701")],
    [{ recipientKey: "a", methodId: "per" }],
    methods,
    config,
    "Some invented day"
  );
  assert.ok(!badDay.ok);
});

test("pickup is free and shipping uses the placeholder rate per destination", () => {
  const result = computeFees(
    [recipient("a", "08701"), recipient("b", "10001")],
    [
      { recipientKey: "a", methodId: "pickup" },
      { recipientKey: "b", methodId: "ship" },
    ],
    methods,
    config,
    null
  );
  assert.ok(result.ok);
  assert.equal(result.feesCents, 1500);
  assert.equal(result.feeLines.length, 1);
});

test("a recipient without a method choice is an error", () => {
  const result = computeFees([recipient("a", "08701")], [], methods, config, null);
  assert.ok(!result.ok);
  assert.match(result.errors[0], /Choose a delivery method/);
});
