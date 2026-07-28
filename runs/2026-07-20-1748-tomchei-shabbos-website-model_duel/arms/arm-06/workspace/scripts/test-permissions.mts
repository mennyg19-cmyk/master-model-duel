// Unit checks for the permission matrix (CI gate, no server needed).
import {
  canImpersonate,
  canTargetStaff,
  hasPermission,
  PERMISSIONS,
  type PermissionSubject,
} from "../lib/permissions";

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

const manager: PermissionSubject = { role: "MANAGER", overrides: [] };
const staff: PermissionSubject = { role: "STAFF", overrides: [] };
const driver: PermissionSubject = { role: "DRIVER", overrides: [] };

// Role defaults
check("manager has every permission", PERMISSIONS.every((p) => hasPermission(manager, p)));
check("staff has admin.access", hasPermission(staff, "admin.access"));
check("staff lacks staff.manage", !hasPermission(staff, "staff.manage"));
check("driver has no permissions", PERMISSIONS.every((p) => !hasPermission(driver, p)));

// Overrides
check(
  "GRANT gives a driver admin.access",
  hasPermission({ role: "DRIVER", overrides: [{ permission: "admin.access", effect: "GRANT" }] }, "admin.access"),
);
check(
  "DENY strips staff.manage from a manager",
  !hasPermission({ role: "MANAGER", overrides: [{ permission: "staff.manage", effect: "DENY" }] }, "staff.manage"),
);

// Self-target blocks (R-119)
check("actor cannot target self", !canTargetStaff("a", "a"));
check("actor can target another", canTargetStaff("a", "b"));

// Impersonation role bound: target role must not exceed actor role.
check("manager can impersonate manager", canImpersonate("MANAGER", "MANAGER"));
check("manager can impersonate driver", canImpersonate("MANAGER", "DRIVER"));
check("staff cannot impersonate manager", !canImpersonate("STAFF", "MANAGER"));
check("staff can impersonate driver", canImpersonate("STAFF", "DRIVER"));
check("staff can impersonate staff (equal)", canImpersonate("STAFF", "STAFF"));
check("driver cannot impersonate staff", !canImpersonate("DRIVER", "STAFF"));

if (failures > 0) {
  console.error(`${failures} permission check(s) failed`);
  process.exit(1);
}
console.log("All permission checks passed");
