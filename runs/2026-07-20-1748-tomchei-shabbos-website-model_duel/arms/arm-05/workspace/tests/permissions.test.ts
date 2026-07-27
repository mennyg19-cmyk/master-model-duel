import assert from "node:assert/strict";
import test from "node:test";
import { hasPermission } from "../lib/permissions";

test("deny override wins over manager role", () => {
  assert.equal(hasPermission("MANAGER", { "audit.read": "DENY" }, "audit.read"), false);
});

test("grant override gives staff a scoped permission", () => {
  assert.equal(hasPermission("STAFF", { "audit.read": "GRANT" }, "audit.read"), true);
});

test("driver has no administrative permissions", () => {
  assert.equal(hasPermission("DRIVER", {}, "staff.manage"), false);
});
