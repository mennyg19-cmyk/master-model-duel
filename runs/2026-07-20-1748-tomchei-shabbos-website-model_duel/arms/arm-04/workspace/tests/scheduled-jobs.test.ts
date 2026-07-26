import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import {
  GEOCODE_FAILURE_TTL_MS,
  GEOCODE_SUCCESS_TTL_MS,
  readGeocodeCache,
  writeGeocodeCache,
} from '../src/lib/geocode-cache';
import { applyScheduledSeasonFlips, SEASON_FLIP_JOB } from '../src/lib/seasons';
import { createSeason, db } from './fixtures';

const HOUR_MS = 60 * 60 * 1000;

after(() => db.$disconnect());

test('a season opens on schedule, closes on schedule, and every run is logged', async () => {
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

test('a season without a schedule is left for the manager to flip', async () => {
  const season = await createSeason('CLOSED');

  await applyScheduledSeasonFlips(new Date('2030-02-01T00:00:00Z'));

  assert.equal((await db.season.findUniqueOrThrow({ where: { id: season.id } })).status, 'CLOSED');
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
