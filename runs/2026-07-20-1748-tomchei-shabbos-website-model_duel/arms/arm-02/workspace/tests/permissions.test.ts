import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePermissions, ALL_PERMISSIONS } from "../lib/auth/permissions";

test("manager gets every permission by default", () => {
  const permissions = resolvePermissions("MANAGER", []);
  for (const permission of ALL_PERMISSIONS) {
    assert.ok(permissions.has(permission), `manager should have ${permission}`);
  }
});

test("staff baseline is orders.view only", () => {
  const permissions = resolvePermissions("STAFF", []);
  assert.deepEqual([...permissions], ["orders.view"]);
});

test("driver baseline is empty", () => {
  assert.equal(resolvePermissions("DRIVER", []).size, 0);
});

test("grant override adds a permission the role lacks", () => {
  const permissions = resolvePermissions("STAFF", [
    { permission: "staff.manage", effect: "GRANT" },
  ]);
  assert.ok(permissions.has("staff.manage"));
});

test("deny override removes a role-default permission", () => {
  const permissions = resolvePermissions("MANAGER", [
    { permission: "staff.manage", effect: "DENY" },
  ]);
  assert.ok(!permissions.has("staff.manage"));
});

test("unknown override permissions are ignored", () => {
  const permissions = resolvePermissions("STAFF", [
    { permission: "not.a.real.permission", effect: "GRANT" },
  ]);
  assert.deepEqual([...permissions], ["orders.view"]);
});
