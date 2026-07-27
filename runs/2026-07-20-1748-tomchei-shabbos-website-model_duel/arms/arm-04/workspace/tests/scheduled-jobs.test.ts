import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import {
  GEOCODE_FAILURE_TTL_MS,
  GEOCODE_SUCCESS_TTL_MS,
  readGeocodeCache,
  writeGeocodeCache,
} from '../src/lib/geocode-cache';
import { applyScheduledSeasonFlips, SEASON_FLIP_JOB } from '../src/lib/seasons/schedule';
import { createSeason, db } from './fixtures';

const HOUR_MS = 60 * 60 * 1000;

after(() => db.$disconnect());

/**
 * The flip sweep reads every season there is, so a test of it has to say what
 * every season there is looks like. Earlier tests in this shared database leave
 * their own seasons open, and one of those with a schedule on it would answer
 * the question instead of the season under test.
 */
async function startWithNoSeasonOpen(): Promise<void> {
  await db.season.updateMany({
    where: { OR: [{ status: 'OPEN' }, { opensAt: { not: null } }] },
    data: { status: 'CLOSED', opensAt: null, closesAt: null },
  });
}

test('a season opens on schedule, closes on schedule, and every run is logged', async () => {
  await startWithNoSeasonOpen();
  const season = await createSeason('CLOSED');
  const opensAt = new Date('2030-01-05T00:00:00Z');
  const closesAt = new Date('2030-03-01T00:00:00Z');
  await db.season.update({ where: { id: season.id }, data: { opensAt, closesAt } });

  await applyScheduledSeasonFlips(new Date('2030-01-01T00:00:00Z'));
  assert.equal((await db.season.findUniqueOrThrow({ where: { id: season.id } })).status, 'CLOSED');

  await applyScheduledSeasonFlips(new Date('2030-02-01T00:00:00Z'));
  assert.equal((await db.season.findUniqueOrThrow({ where: { id: season.id } })).status, 'OPEN');

  await applyScheduledSeasonFlips(new Date('2030-03-02T00:00:00Z'));
  assert.equal((await db.season.findUniqueOrThrow({ where: { id: season.id } })).status, 'CLOSED');

  const runs = await db.cronRunLog.findMany({
    where: { jobName: SEASON_FLIP_JOB },
    orderBy: { startedAt: 'desc' },
    take: 3,
  });

  assert.equal(runs.length, 3);
  assert.ok(runs.every((run) => run.status === 'SUCCEEDED' && run.finishedAt !== null));
});

test('a scheduled open closes whichever season was open, so the store has one catalogue', async () => {
  await startWithNoSeasonOpen();
  const outgoing = await createSeason('OPEN');
  const incoming = await createSeason('CLOSED');
  await db.season.update({
    where: { id: incoming.id },
    data: { opensAt: new Date('2030-01-05T00:00:00Z') },
  });

  const summary = await applyScheduledSeasonFlips(new Date('2030-01-06T00:00:00Z'));

  assert.equal(summary.opened, 1);
  assert.equal((await db.season.findUniqueOrThrow({ where: { id: incoming.id } })).status, 'OPEN');
  assert.equal((await db.season.findUniqueOrThrow({ where: { id: outgoing.id } })).status, 'CLOSED');
});

test('a season without a schedule is left for the manager to flip', async () => {
  await startWithNoSeasonOpen();
  const season = await createSeason('CLOSED');

  await applyScheduledSeasonFlips(new Date('2030-02-01T00:00:00Z'));

  assert.equal((await db.season.findUniqueOrThrow({ where: { id: season.id } })).status, 'CLOSED');
});

test('every scheduled flip is audited the way the manager’s own switch is', async () => {
  await startWithNoSeasonOpen();
  const season = await createSeason('CLOSED');
  await db.season.update({
    where: { id: season.id },
    data: { opensAt: new Date('2030-01-05T00:00:00Z') },
  });

  await applyScheduledSeasonFlips(new Date('2030-01-06T00:00:00Z'));

  const audits = await db.auditEvent.findMany({
    where: { action: 'season.status_changed', entityId: season.id },
  });

  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].detail, { year: season.year, to: 'OPEN', scheduled: true });
  assert.equal(audits[0].actorLabel, 'system');
});

test('a closing date the manager typed is not overruled by a season falling due', async () => {
  await startWithNoSeasonOpen();
  const outgoing = await createSeason('OPEN');
  const incoming = await createSeason('CLOSED');
  await db.season.update({
    where: { id: outgoing.id },
    data: { closesAt: new Date('2030-06-01T00:00:00Z') },
  });
  await db.season.update({
    where: { id: incoming.id },
    data: { opensAt: new Date('2030-01-05T00:00:00Z') },
  });

  const summary = await applyScheduledSeasonFlips(new Date('2030-01-06T00:00:00Z'));

  assert.equal(summary.opened, 0, 'opening would have closed a season three months early');
  assert.equal(summary.closed, 0);
  assert.equal((await db.season.findUniqueOrThrow({ where: { id: outgoing.id } })).status, 'OPEN');
  assert.equal((await db.season.findUniqueOrThrow({ where: { id: incoming.id } })).status, 'CLOSED');

  await db.season.update({ where: { id: outgoing.id }, data: { status: 'CLOSED' } });
});

test('a geocode hit is served from the cache until it expires', async () => {
  const addressKey = `412 forest avenue|apt 3b|lakewood|nj|08701|us|${Date.now()}`;
  const now = new Date('2030-01-01T00:00:00Z');

  await writeGeocodeCache(
    { addressKey, outcome: 'FOUND', latitude: 40.09, longitude: -74.21, provider: 'mapbox' },
    now,
  );

  const fresh = await readGeocodeCache(addressKey, new Date(now.getTime() + HOUR_MS));
  assert.equal(fresh?.latitude, 40.09);

  const stale = await readGeocodeCache(addressKey, new Date(now.getTime() + GEOCODE_SUCCESS_TTL_MS + 1));
  assert.equal(stale, null, 'an expired hit must be looked up again');
});

test('a geocode miss expires far sooner than a hit', async () => {
  const addressKey = `nowhere street|middletown|nj|00000|us|${Date.now()}`;
  const now = new Date('2030-01-01T00:00:00Z');

  await writeGeocodeCache({ addressKey, outcome: 'NOT_FOUND', provider: 'mapbox' }, now);

  const withinTtl = await readGeocodeCache(addressKey, new Date(now.getTime() + GEOCODE_FAILURE_TTL_MS - 1));
  assert.equal(withinTtl?.outcome, 'NOT_FOUND');

  const afterTtl = await readGeocodeCache(addressKey, new Date(now.getTime() + GEOCODE_FAILURE_TTL_MS + 1));
  assert.equal(afterTtl, null);

  assert.ok(GEOCODE_FAILURE_TTL_MS < GEOCODE_SUCCESS_TTL_MS);
});
