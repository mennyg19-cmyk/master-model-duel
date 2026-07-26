import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALL_PERMISSIONS,
  effectivePermissions,
  hasPermission,
  roleDefaults,
} from '../src/lib/auth/permissions';

test('managers hold every permission by default', () => {
  assert.deepEqual(effectivePermissions('MANAGER', []), ALL_PERMISSIONS);
});

test('staff cannot manage staff or read the audit log by default', () => {
  assert.equal(hasPermission('STAFF', [], 'staff.manage'), false);
  assert.equal(hasPermission('STAFF', [], 'audit.view'), false);
  assert.equal(hasPermission('STAFF', [], 'orders.view'), true);
});

test('drivers get only their route permission', () => {
  assert.deepEqual(roleDefaults('DRIVER'), ['routes.drive']);
  assert.equal(hasPermission('DRIVER', [], 'dashboard.view'), false);
});

test('a grant adds a permission the role does not include', () => {
  const overrides = [{ permission: 'audit.view', effect: 'GRANT' as const }];
  assert.equal(hasPermission('STAFF', overrides, 'audit.view'), true);
});

test('a deny removes a permission the role does include', () => {
  const overrides = [{ permission: 'orders.manage', effect: 'DENY' as const }];
  assert.equal(hasPermission('STAFF', overrides, 'orders.manage'), false);
});

test('deny beats grant on the same permission', () => {
  const overrides = [
    { permission: 'staff.manage', effect: 'GRANT' as const },
    { permission: 'staff.manage', effect: 'DENY' as const },
  ];
  assert.equal(hasPermission('STAFF', overrides, 'staff.manage'), false);
});

test('deny can strip a permission from a manager', () => {
  const overrides = [{ permission: 'staff.impersonate', effect: 'DENY' as const }];
  assert.equal(hasPermission('MANAGER', overrides, 'staff.impersonate'), false);
  assert.equal(hasPermission('MANAGER', overrides, 'staff.manage'), true);
});

test('an override for another permission does not leak', () => {
  const overrides = [{ permission: 'settings.manage', effect: 'GRANT' as const }];
  assert.equal(hasPermission('STAFF', overrides, 'staff.manage'), false);
});
