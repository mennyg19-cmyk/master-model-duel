import { StaffRole, PermissionEffect } from "@prisma/client";
import assert from "node:assert/strict";
import {
  hasPermission,
  resolvePermissions,
  roleDefaultPermissions,
} from "../src/lib/permissions";

function testPermissions() {
  const manager = resolvePermissions(StaffRole.MANAGER, []);
  assert.equal(manager.has("staff.manage"), true);
  assert.equal(manager.has("driver.access"), true);

  const staff = resolvePermissions(StaffRole.STAFF, []);
  assert.equal(staff.has("admin.access"), true);
  assert.equal(staff.has("staff.manage"), false);

  const staffDeniedAdmin = resolvePermissions(StaffRole.STAFF, [
    { permission: "admin.access", effect: PermissionEffect.DENY },
  ]);
  assert.equal(staffDeniedAdmin.has("admin.access"), false);

  const driverGranted = resolvePermissions(StaffRole.DRIVER, [
    { permission: "admin.access", effect: PermissionEffect.GRANT },
  ]);
  assert.equal(driverGranted.has("admin.access"), true);
  assert.equal(driverGranted.has("driver.access"), true);

  assert.equal(
    hasPermission(
      { role: StaffRole.STAFF, isActive: false, revokedAt: null },
      [],
      "admin.access",
    ),
    false,
  );

  assert.ok(roleDefaultPermissions(StaffRole.MANAGER).length >= 5);
  console.log("permissions unit tests: ok");
}

testPermissions();
