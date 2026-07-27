import { test } from "node:test";
import assert from "node:assert/strict";
import { addressInputSchema, normalizedAddressKey } from "../lib/addresses/normalize";

const baseAddress = {
  recipient: "Rivka Friedman",
  line1: "12 Main St",
  city: "Lakewood",
  state: "NJ",
  zip: "08701",
};

test("dedupe key ignores case, punctuation, and suffix spelling", () => {
  const key = normalizedAddressKey(baseAddress);
  assert.equal(
    normalizedAddressKey({ ...baseAddress, recipient: "RIVKA  FRIEDMAN", line1: "12 Main Street." }),
    key
  );
  assert.equal(normalizedAddressKey({ ...baseAddress, line1: "12   main st" }), key);
});

test("dedupe key separates genuinely different addresses", () => {
  const key = normalizedAddressKey(baseAddress);
  assert.notEqual(normalizedAddressKey({ ...baseAddress, line1: "14 Main St" }), key);
  assert.notEqual(normalizedAddressKey({ ...baseAddress, recipient: "Someone Else" }), key);
  assert.notEqual(normalizedAddressKey({ ...baseAddress, zip: "08753" }), key);
});

test("validation rejects malformed state and zip, uppercases state", () => {
  assert.equal(addressInputSchema.safeParse({ ...baseAddress, zip: "8701" }).success, false);
  assert.equal(addressInputSchema.safeParse({ ...baseAddress, state: "New Jersey" }).success, false);
  const parsed = addressInputSchema.parse({ ...baseAddress, state: "nj" });
  assert.equal(parsed.state, "NJ");
});
