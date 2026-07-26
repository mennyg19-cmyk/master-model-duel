import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import {
  INVALID_TOKEN,
  loadByToken,
  subscribe,
  unsubscribeByToken,
  updatePreferencesByToken,
} from '../src/lib/newsletter/subscriptions';
import {
  createUnsubscribeToken,
  readUnsubscribeToken,
  UNSUBSCRIBE_TOKEN_TTL_MS,
} from '../src/lib/newsletter/tokens';
import { db } from './fixtures';

after(() => db.$disconnect());

let sequence = 0;

function nextEmail(): string {
  sequence += 1;
  return `subscriber-${Date.now().toString(36)}${sequence}@example.test`;
}

test('an unsubscribe token round-trips and names the subscriber', () => {
  const token = createUnsubscribeToken('subscriber-1');
  assert.deepEqual(readUnsubscribeToken(token), { valid: true, subscriberId: 'subscriber-1' });
});

test('a tampered, truncated or missing token is refused', () => {
  const token = createUnsubscribeToken('subscriber-1');
  const [body, signature] = token.split('.');

  assert.equal(readUnsubscribeToken(undefined).valid, false);
  assert.deepEqual(readUnsubscribeToken(body), { valid: false, reason: 'malformed' });
  assert.deepEqual(readUnsubscribeToken(`${body}.${signature}x`), {
    valid: false,
    reason: 'bad_signature',
  });

  // The payload names a different subscriber but keeps the original signature.
  const forgedBody = Buffer.from(
    JSON.stringify({ sub: 'someone-else', exp: Date.now() + UNSUBSCRIBE_TOKEN_TTL_MS }),
    'utf8',
  ).toString('base64url');
  assert.deepEqual(readUnsubscribeToken(`${forgedBody}.${signature}`), {
    valid: false,
    reason: 'bad_signature',
  });
});

test('a token stops working once it expires', () => {
  const issued = new Date('2026-01-01T00:00:00Z');
  const token = createUnsubscribeToken('subscriber-1', issued);
  const afterExpiry = new Date(issued.getTime() + UNSUBSCRIBE_TOKEN_TTL_MS + 1);

  assert.deepEqual(readUnsubscribeToken(token, afterExpiry), { valid: false, reason: 'expired' });
});

test('subscribing twice keeps one row and is not an error', async () => {
  const email = nextEmail();

  const first = await subscribe({ email, source: 'footer' });
  const second = await subscribe({ email: email.toUpperCase(), source: 'newsletter-page' });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  assert.equal(second.value.subscriber.id, first.value.subscriber.id);
  assert.equal(await db.newsletterSubscriber.count({ where: { normalizedEmail: email } }), 1);
});

test('a malformed address never reaches the database', async () => {
  const attempt = await subscribe({ email: 'not-an-address', source: 'footer' });

  assert.equal(attempt.ok, false);
  assert.equal(await db.newsletterSubscriber.count({ where: { email: 'not-an-address' } }), 0);
});

test('preferences and unsubscribing work from the signed link alone', async () => {
  const subscribed = await subscribe({ email: nextEmail(), source: 'footer' });
  assert.equal(subscribed.ok, true);
  if (!subscribed.ok) return;

  const { manageToken } = subscribed.value;

  const updated = await updatePreferencesByToken(manageToken, {
    wantsSeasonAnnouncements: true,
    wantsOrderReminders: false,
    wantsImpactStories: false,
  });
  assert.equal(updated.ok && updated.value.wantsOrderReminders, false);

  const unsubscribed = await unsubscribeByToken(manageToken);
  assert.equal(unsubscribed.ok && unsubscribed.value.status, 'UNSUBSCRIBED');
  assert.equal(unsubscribed.ok && unsubscribed.value.unsubscribedAt !== null, true);

  // Unsubscribing twice is idempotent, and the row is never deleted.
  const again = await unsubscribeByToken(manageToken);
  assert.equal(again.ok && again.value.status, 'UNSUBSCRIBED');

  // Re-subscribing the same address turns it back on: asking again is consent.
  const resubscribed = await subscribe({
    email: subscribed.value.subscriber.email,
    source: 'footer',
  });
  assert.equal(resubscribed.ok && resubscribed.value.subscriber.status, 'SUBSCRIBED');
  assert.equal(resubscribed.ok && resubscribed.value.subscriber.unsubscribedAt, null);
});

test('an unknown subscriber id fails the same way a bad signature does', async () => {
  const token = createUnsubscribeToken('11111111-1111-4111-8111-111111111111');
  const loaded = await loadByToken(token);

  assert.equal(loaded.ok, false);
  assert.equal(loaded.ok === false && loaded.code, INVALID_TOKEN);
});
