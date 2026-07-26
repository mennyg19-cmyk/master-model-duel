import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCents, sumCents, toCents } from '../src/lib/core/money';
import { normalizeEmail } from '../src/lib/core/normalize';
import { formatPhone, normalizePhone } from '../src/lib/core/phone';
import { seasonYearFor } from '../src/lib/core/season';

test('money stays in whole cents', () => {
  assert.equal(toCents(18.99), 1899);
  assert.equal(toCents(0.1) + toCents(0.2), 30);
  assert.equal(formatCents(1899), '$18.99');
  assert.equal(formatCents(-500), '-$5.00');
  assert.equal(sumCents([1899, 101]), 2000);
});

test('emails normalize to a stable dedupe key', () => {
  assert.equal(normalizeEmail('  Sara@Example.COM '), 'sara@example.com');
});

test('phone numbers store as E.164 and reject bad input', () => {
  assert.equal(normalizePhone('(555) 123-4567'), '+15551234567');
  assert.equal(normalizePhone('1-555-123-4567'), '+15551234567');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(formatPhone('+15551234567'), '(555) 123-4567');
});

test('the season year rolls over on July 1', () => {
  assert.equal(seasonYearFor(new Date('2026-03-01T12:00:00')), 2026);
  assert.equal(seasonYearFor(new Date('2026-08-01T12:00:00')), 2027);
});
