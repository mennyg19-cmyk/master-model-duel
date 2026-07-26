import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

import { PrismaClient } from '@prisma/client';

import { bootstrapFirstManager, isSetupLocked, SETUP_LOCK_KEY } from '../src/lib/bootstrap';
import { linkCustomerIdentity } from '../src/lib/customers';

const db = new PrismaClient();

after(() => db.$disconnect());

beforeEach(async () => {
  await db.auditEvent.deleteMany();
  await db.permissionOverride.deleteMany();
  await db.staffLoginSession.deleteMany();
  await db.staffUser.deleteMany();
  await db.customer.deleteMany();
  await db.setting.deleteMany({ where: { key: SETUP_LOCK_KEY } });
});

test('an empty database allows bootstrap, then locks', async () => {
  assert.equal(await isSetupLocked(), false);

  const first = await bootstrapFirstManager({
    email: 'First.Manager@Tomchei.example',
    fullName: 'First Manager',
    externalAuthId: 'local:first.manager@tomchei.example',
  });

  assert.equal(first.ok, true);
  assert.equal(first.ok && first.value.role, 'MANAGER');
  assert.equal(first.ok && first.value.email, 'first.manager@tomchei.example');
  assert.equal(await isSetupLocked(), true);

  const second = await bootstrapFirstManager({
    email: 'second.manager@tomchei.example',
    fullName: 'Second Manager',
    externalAuthId: null,
  });

  assert.equal(second.ok, false);
  assert.equal(second.ok === false && second.code, 'setup_locked');
  assert.equal(await db.staffUser.count(), 1);
});

test('concurrent bootstrap attempts create exactly one manager', async () => {
  const attempts = await Promise.all(
    Array.from({ length: 5 }, (_unused, index) =>
      bootstrapFirstManager({
        email: `race-${index}@tomchei.example`,
        fullName: `Race ${index}`,
        externalAuthId: null,
      }),
    ),
  );

  assert.equal(attempts.filter((attempt) => attempt.ok).length, 1);
  assert.equal(await db.staffUser.count(), 1);
});

test('bootstrap writes an audit row naming the new manager', async () => {
  const created = await bootstrapFirstManager({
    email: 'audited@tomchei.example',
    fullName: 'Audited Manager',
    externalAuthId: null,
  });
  assert.equal(created.ok, true);

  const audit = await db.auditEvent.findFirst({ where: { action: 'setup.first_manager_created' } });
  assert.ok(audit, 'bootstrap must leave an audit trail');
  assert.equal(audit?.entityId, created.ok ? created.value.id : null);
});

test('a customer identity links by email and never becomes staff', async () => {
  await db.customer.create({
    data: {
      email: 'Legacy.Donor@Example.com',
      normalizedEmail: 'legacy.donor@example.com',
      fullName: 'Legacy Donor',
    },
  });

  const linked = await linkCustomerIdentity({
    externalId: 'clerk_user_123',
    email: 'LEGACY.DONOR@example.com',
    fullName: 'Legacy Donor',
  });

  assert.equal(linked.externalAuthId, 'clerk_user_123');
  assert.equal(await db.customer.count(), 1, 'linking must not create a duplicate customer');
  assert.equal(
    await db.staffUser.count({ where: { email: 'legacy.donor@example.com' } }),
    0,
    'a customer must never appear in the staff table',
  );

  const relinked = await linkCustomerIdentity({
    externalId: 'clerk_user_123',
    email: 'legacy.donor@example.com',
    fullName: 'Legacy Donor',
  });
  assert.equal(relinked.id, linked.id);
});

test('two simultaneous first links settle on one customer', async () => {
  const identity = {
    externalId: 'clerk_user_race',
    email: 'race.donor@example.com',
    fullName: 'Race Donor',
  };

  const [first, second] = await Promise.all([
    linkCustomerIdentity(identity),
    linkCustomerIdentity(identity),
  ]);

  assert.equal(first.id, second.id, 'the loser of the race must read the winning row');
  assert.equal(await db.customer.count(), 1);
});
