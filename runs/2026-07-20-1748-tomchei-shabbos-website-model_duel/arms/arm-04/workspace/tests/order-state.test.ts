import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, assertTransition } from "../lib/domain/order-state";

test("draft can finalize or discard", () => {
  assert.ok(canTransition("DRAFT", "FINALIZED"));
  assert.ok(canTransition("DRAFT", "DISCARDED"));
});

test("finalized and discarded are terminal", () => {
  assert.throws(() => assertTransition("FINALIZED", "DRAFT"), /Illegal order transition/);
  assert.throws(() => assertTransition("FINALIZED", "DISCARDED"), /Illegal order transition/);
  assert.throws(() => assertTransition("DISCARDED", "DRAFT"), /Illegal order transition/);
  assert.throws(() => assertTransition("DISCARDED", "FINALIZED"), /Illegal order transition/);
});

test("no self-transitions", () => {
  assert.throws(() => assertTransition("DRAFT", "DRAFT"), /Illegal order transition/);
});
