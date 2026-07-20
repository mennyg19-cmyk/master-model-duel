import { test } from "node:test";
import assert from "node:assert/strict";
import { cartSchema } from "../lib/order-builder/cart";

const address = {
  recipient: "Rivka Friedman",
  line1: "12 Main St",
  city: "Lakewood",
  state: "NJ",
  zip: "08701",
};

test("cart schema accepts the three assignment shapes and null", () => {
  const cart = cartSchema.parse({
    onOrderRecipient: address,
    lines: [
      { id: "a", productId: "p1", quantity: 2, assignment: { type: "onOrder" } },
      { id: "b", productId: "p2", quantity: 1, assignment: { type: "addressBook", addressId: "addr1" } },
      { id: "c", productId: "p3", quantity: 1, assignment: { type: "newRecipient", address } },
      { id: "d", productId: "p4", quantity: 1 },
    ],
  });
  assert.equal(cart.lines.length, 4);
  assert.equal(cart.lines[3].assignment, null);
  assert.deepEqual(cart.lines[0].optionIds, []);
});

test("cart schema rejects bad quantities and unknown assignment types", () => {
  assert.equal(
    cartSchema.safeParse({ lines: [{ id: "a", productId: "p1", quantity: 0 }] }).success,
    false
  );
  assert.equal(
    cartSchema.safeParse({
      lines: [{ id: "a", productId: "p1", quantity: 1, assignment: { type: "somebodyElse" } }],
    }).success,
    false
  );
});
