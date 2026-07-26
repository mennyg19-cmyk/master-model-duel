import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { PrismaClient } from '@prisma/client';

import { STALE_VERSION, updateStaffVersioned } from '../src/lib/staff-service';

const db = new PrismaClient();
const CONCURRENT_WRITERS = 10;

after(() => db.$disconnect());

test('10 concurrent versioned updates report conflicts instead of overwriting', async () => {
  const fixture = await db.staffUser.create({
    data: {
      email: `concurrency-${Date.now()}@tomchei.example`,
      fullName: 'Concurrency Fixture',
      role: 'STAFF',
      status: 'ACTIVE',
    },
  });

  const startingVersion = fixture.version;

  const attempts = await Promise.all(
    Array.from({ length: CONCURRENT_WRITERS }, (_unused, index) =>
      updateStaffVersioned(fixture.id, startingVersion, { fullName: `Writer ${index}` }),
    ),
  );

  const winners = attempts.filter((attempt) => attempt.ok);
  const conflicts = attempts.filter((attempt) => !attempt.ok);

  assert.equal(winners.length, 1, 'exactly one writer should win the race');
  assert.equal(conflicts.length, CONCURRENT_WRITERS - 1);
  assert.ok(conflicts.every((conflict) => !conflict.ok && conflict.code === STALE_VERSION));

  const finalRow = await db.staffUser.findUniqueOrThrow({ where: { id: fixture.id } });
  assert.equal(finalRow.version, startingVersion + 1, 'only the winning write may bump the version');
  assert.match(finalRow.fullName, /^Writer \d$/);

  await db.staffUser.delete({ where: { id: fixture.id } });
});

test('a stale version is rejected after a successful update', async () => {
  const fixture = await db.staffUser.create({
    data: {
      email: `stale-${Date.now()}@tomchei.example`,
      fullName: 'Stale Fixture',
      role: 'STAFF',
      status: 'ACTIVE',
    },
  });

  const first = await updateStaffVersioned(fixture.id, fixture.version, { fullName: 'Renamed once' });
  assert.equal(first.ok, true);

  const replay = await updateStaffVersioned(fixture.id, fixture.version, { fullName: 'Renamed twice' });
  assert.equal(replay.ok, false);

  const finalRow = await db.staffUser.findUniqueOrThrow({ where: { id: fixture.id } });
  assert.equal(finalRow.fullName, 'Renamed once');

  await db.staffUser.delete({ where: { id: fixture.id } });
});
