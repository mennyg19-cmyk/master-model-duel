import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNextStages, canAdvancePackage, terminalStageFor } from "../lib/domain/package-stage";

test("stages advance forward only, skipping allowed", () => {
  assert.ok(canAdvancePackage("NEW", "PRINTED", "SHIPPING").ok);
  assert.ok(canAdvancePackage("NEW", "SENT", "SHIPPING").ok); // optional stages: skip straight to done
  assert.ok(canAdvancePackage("PRINTED", "PACKED", "SHIPPING").ok);
  assert.equal(canAdvancePackage("PACKED", "PRINTED", "SHIPPING").ok, false);
  assert.equal(canAdvancePackage("SENT", "PACKED", "SHIPPING").ok, false);
  assert.equal(canAdvancePackage("PRINTED", "PRINTED", "SHIPPING").ok, false);
});

test("terminal stage follows the channel kind", () => {
  assert.equal(terminalStageFor("PICKUP"), "PICKED_UP");
  assert.equal(terminalStageFor("SHIPPING"), "SENT");
  assert.equal(terminalStageFor("BULK_DELIVERY"), "SENT");
  assert.equal(canAdvancePackage("PACKED", "SENT", "PICKUP").ok, false);
  assert.equal(canAdvancePackage("PACKED", "PICKED_UP", "SHIPPING").ok, false);
  assert.ok(canAdvancePackage("PACKED", "PICKED_UP", "PICKUP").ok);
});

test("allowed next stages shrink as the package advances", () => {
  assert.deepEqual(allowedNextStages("NEW", "SHIPPING"), ["PRINTED", "PACKED", "SENT"]);
  assert.deepEqual(allowedNextStages("PACKED", "PICKUP"), ["PICKED_UP"]);
  assert.deepEqual(allowedNextStages("SENT", "SHIPPING"), []);
});
