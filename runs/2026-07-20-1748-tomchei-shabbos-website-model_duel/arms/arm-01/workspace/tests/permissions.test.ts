import assert from "node:assert/strict";
import test from "node:test";
import { hasPermission } from "../src/lib/permissions";

test("manager receives the full role permission set", () => {
  assert.equal(
    hasPermission(
      { role: "MANAGER", grantPermissions: [], denyPermissions: [] },
      "staff:manage",
    ),
    true,
  );
});

test("driver receives no admin access", () => {
  assert.equal(
    hasPermission(
      { role: "DRIVER", grantPermissions: [], denyPermissions: [] },
      "admin:view",
    ),
    false,
  );
});

test("a personal grant adds permission to staff", () => {
  assert.equal(
    hasPermission(
      {
        role: "STAFF",
        grantPermissions: ["audit:view"],
        denyPermissions: [],
      },
      "audit:view",
    ),
    true,
  );
});

test("a personal deny wins over role and grant permissions", () => {
  assert.equal(
    hasPermission(
      {
        role: "MANAGER",
        grantPermissions: ["staff:manage"],
        denyPermissions: ["staff:manage"],
      },
      "staff:manage",
    ),
    false,
  );
});
