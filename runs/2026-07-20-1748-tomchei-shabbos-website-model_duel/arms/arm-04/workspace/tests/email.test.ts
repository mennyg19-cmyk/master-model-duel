import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { renderBrandedHtml, senderLine } from '../src/lib/email/branding';
import { countAudience, sendCampaign } from '../src/lib/email/campaigns';
import { addToList, createSubscriberList } from '../src/lib/email/subscriber-lists';
import {
  renderTriggeredEmail,
  TRIGGERED_TEMPLATES,
  unknownPlaceholders,
} from '../src/lib/email/templates';
import { CAPTURE_REFUSED_PREFIX } from '../src/lib/messaging/capture';
import { MAX_DELIVERY_ATTEMPTS, sweepNotificationOutbox } from '../src/lib/notifications/dispatch';
import { queueMessage } from '../src/lib/notifications/outbox';
import { purgeDeliveredMessages } from '../src/lib/notifications/purge';
import { writeSetting } from '../src/lib/settings';
import { db } from './fixtures';

after(() => db.$disconnect());

/**
 * Every test here runs against the capture provider, which is what CI and
 * development use. The point is to exercise the real queue, the real templates
 * and the real retry arithmetic without a network call.
 */
before(async () => {
  await writeSetting('email.fromName', 'Tomchei Shabbos');
  await writeSetting('email.fromAddress', 'office@tomchei.example');
  await writeSetting('email.replyToAddress', '');
  await writeSetting('email.logoUrl', '');
  await writeSetting('email.footerText', 'Tomchei Shabbos · https://tomchei.example');
  await writeSetting('email.accentColor', '#8a1c1c');
});

let sequence = 0;

function nextKey(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence.toString(36)}`;
}

async function createSubscriber(
  overrides: { status?: 'SUBSCRIBED' | 'UNSUBSCRIBED'; wantsImpactStories?: boolean } = {},
) {
  const email = `reader-${nextKey()}@example.test`;
  return db.newsletterSubscriber.create({
    data: { email, normalizedEmail: email, ...overrides },
  });
}

test('a triggered email uses the shipped wording until it is overridden', async () => {
  const shipped = await renderTriggeredEmail('order.confirmation', {
    customerName: 'Rivka Stern',
    orderLabel: 'order #218',
    total: '$180.00',
    packageCount: '3 boxes',
    orderUrl: 'https://example.test/account/orders/218',
  });

  assert.equal(shipped?.subject, 'We have your order, Rivka Stern');
  assert.ok(shipped?.body.includes('3 boxes'));
  assert.ok(!shipped?.body.includes('{{'), 'no placeholder should survive rendering');

  await db.emailTemplate.upsert({
    where: { key: 'order.confirmation' },
    create: { key: 'order.confirmation', subject: 'Thank you {{customerName}}', body: 'Short.' },
    update: { subject: 'Thank you {{customerName}}', body: 'Short.', isEnabled: true },
  });

  const overridden = await renderTriggeredEmail('order.confirmation', { customerName: 'Rivka' });
  assert.equal(overridden?.subject, 'Thank you Rivka');

  // Switched off means the app writes nothing at all, rather than an empty email.
  await db.emailTemplate.update({
    where: { key: 'order.confirmation' },
    data: { isEnabled: false },
  });
  assert.equal(await renderTriggeredEmail('order.confirmation', {}), null);

  await db.emailTemplate.deleteMany({ where: { key: 'order.confirmation' } });
});

test('a placeholder the app cannot fill is named before it is saved', () => {
  assert.deepEqual(
    unknownPlaceholders('order.refund', 'Hello {{customerName}}, about {{ordreLabel}}'),
    ['ordreLabel'],
  );
  assert.deepEqual(
    unknownPlaceholders('order.refund', TRIGGERED_TEMPLATES['order.refund'].body),
    [],
  );
});

test('the letterhead escapes what a donor typed and links what they wrote', () => {
  const html = renderBrandedHtml(
    {
      fromName: 'Tomchei Shabbos',
      fromAddress: 'office@tomchei.example',
      replyToAddress: '',
      logoUrl: '',
      footerText: '',
      accentColor: '#8a1c1c',
    },
    { subject: 'Boxes & <script>alert(1)</script>', body: 'Order at https://tomchei.example/order' },
  );

  assert.ok(!html.includes('<script>'), 'a subject line must never become markup');
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('<a href="https://tomchei.example/order"'));
});

test('the sender line is blank until an address is configured', () => {
  const branding = {
    fromName: 'Tomchei Shabbos',
    fromAddress: '',
    replyToAddress: '',
    logoUrl: '',
    footerText: '',
    accentColor: '#8a1c1c',
  };

  assert.equal(senderLine(branding), null);
  assert.equal(
    senderLine({ ...branding, fromAddress: 'office@tomchei.example' }),
    'Tomchei Shabbos <office@tomchei.example>',
  );
});

test('the sweeper sends a queued message once and records how it went', async () => {
  const dedupeKey = `test.sweep:${nextKey()}`;
  await queueMessage({
    channel: 'EMAIL',
    kind: 'test.sweep',
    destination: `sweep-${nextKey()}@example.test`,
    subject: 'Hello',
    body: 'A short letter.',
    dedupeKey,
  });

  await sweepNotificationOutbox();

  const message = await db.notificationLog.findUniqueOrThrow({
    where: { dedupeKey },
    include: { attemptTrail: true },
  });

  assert.equal(message.status, 'SENT');
  assert.equal(message.attempts, 1);
  assert.ok(message.providerReference, 'a sent message keeps what the provider called it');
  assert.deepEqual(
    message.attemptTrail.map((attempt) => attempt.outcome),
    ['SENT'],
  );

  // Capture mode means the letter is readable rather than delivered.
  const captured = await db.capturedMessage.findUniqueOrThrow({
    where: { id: message.providerReference ?? '' },
  });
  assert.equal(captured.subject, 'Hello');

  // A second sweep has nothing to do: sent rows are never claimed again.
  const second = await sweepNotificationOutbox();
  assert.equal(second.claimed, 0);
});

test('a refused message backs off, keeps a trail and is given up on after five tries', async () => {
  const dedupeKey = `test.bounce:${nextKey()}`;
  await queueMessage({
    channel: 'EMAIL',
    kind: 'test.bounce',
    destination: `${CAPTURE_REFUSED_PREFIX}-${nextKey()}@example.test`,
    subject: 'Hello',
    body: 'A short letter.',
    dedupeKey,
  });

  const start = new Date();
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    // Each sweep is a day later, so the backoff never hides a retry from us.
    await sweepNotificationOutbox({ now: new Date(start.getTime() + attempt * 86_400_000) });

    const midway = await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey } });
    assert.equal(midway.attempts, attempt);
    assert.equal(midway.status, attempt < MAX_DELIVERY_ATTEMPTS ? 'QUEUED' : 'FAILED');
    if (attempt < MAX_DELIVERY_ATTEMPTS) {
      assert.ok(midway.nextAttemptAt, 'a message still worth retrying knows when to try again');
    }
  }

  const failed = await db.notificationLog.findUniqueOrThrow({
    where: { dedupeKey },
    include: { attemptTrail: true },
  });

  assert.equal(failed.attemptTrail.length, MAX_DELIVERY_ATTEMPTS);
  assert.ok(failed.lastError?.includes('422'), 'the trail says what the provider objected to');
  assert.ok(failed.failedAt);
});

test('a message that is not due yet is left where it is', async () => {
  const dedupeKey = `test.backoff:${nextKey()}`;
  await queueMessage({
    channel: 'EMAIL',
    kind: 'test.backoff',
    destination: `${CAPTURE_REFUSED_PREFIX}-${nextKey()}@example.test`,
    subject: 'Hello',
    body: 'A short letter.',
    dedupeKey,
  });

  await sweepNotificationOutbox();
  const refused = await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey } });

  // The sweeper runs every minute; the first retry is due in one. This is the
  // check that the wait is honoured rather than compared through the server's
  // local timezone, which reads an hour of backoff as already past.
  await sweepNotificationOutbox();
  const untouched = await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey } });

  assert.equal(refused.attempts, 1);
  assert.ok(refused.nextAttemptAt && refused.nextAttemptAt > new Date());
  assert.equal(untouched.attempts, 1, 'a second sweep a moment later must not retry it');
});

test('email waits for a sender address while texts still go out', async () => {
  await writeSetting('email.fromAddress', '');

  const emailKey = `test.held:${nextKey()}`;
  const smsKey = `test.text:${nextKey()}`;
  await queueMessage({
    channel: 'EMAIL',
    kind: 'test.held',
    destination: `held-${nextKey()}@example.test`,
    subject: 'Waiting',
    body: 'Held back.',
    dedupeKey: emailKey,
  });
  await queueMessage({
    channel: 'SMS',
    kind: 'test.text',
    destination: '+15550100',
    body: 'Your box is ready.',
    dedupeKey: smsKey,
  });

  const summary = await sweepNotificationOutbox();
  assert.ok(summary.blocked > 0, 'the sweep says how much email is stuck behind the sender');

  assert.equal((await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: emailKey } })).status, 'QUEUED');

  const text = await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: smsKey } });
  assert.equal(text.status, 'SENT', 'SMS has its own provider and its own sender');

  // Once there is somebody to send from, the held email goes without being requeued.
  await writeSetting('email.fromAddress', 'office@tomchei.example');
  await sweepNotificationOutbox();
  assert.equal((await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: emailKey } })).status, 'SENT');
});

test('the purge takes delivered mail and leaves everything still owed', async () => {
  await writeSetting('email.logRetentionDays', 30);
  const longAgo = new Date(Date.now() - 400 * 86_400_000);

  const old = await db.notificationLog.create({
    data: {
      channel: 'EMAIL',
      kind: 'test.purge',
      destination: `old-${nextKey()}@example.test`,
      body: 'Delivered long ago.',
      dedupeKey: `test.purge.sent:${nextKey()}`,
      status: 'SENT',
      sentAt: longAgo,
      createdAt: longAgo,
    },
  });

  const stillFailing = await db.notificationLog.create({
    data: {
      channel: 'EMAIL',
      kind: 'test.purge',
      destination: `stuck-${nextKey()}@example.test`,
      body: 'Never got there.',
      dedupeKey: `test.purge.failed:${nextKey()}`,
      status: 'FAILED',
      failedAt: longAgo,
      createdAt: longAgo,
    },
  });

  const summary = await purgeDeliveredMessages();

  assert.equal(summary.retentionDays, 30);
  assert.equal(await db.notificationLog.count({ where: { id: old.id } }), 0);
  assert.equal(
    await db.notificationLog.count({ where: { id: stillFailing.id } }),
    1,
    'a message nobody received is evidence, not clutter',
  );

  await db.notificationLog.delete({ where: { id: stillFailing.id } });
});

test('a campaign reaches its audience once, however many times it is sent', async () => {
  const [first, second, unsubscribed] = await Promise.all([
    createSubscriber(),
    createSubscriber(),
    createSubscriber({ status: 'UNSUBSCRIBED' }),
  ]);

  const list = await createSubscriberList({ name: `Gabbaim ${nextKey()}`, description: '' });
  assert.equal(list.ok, true);
  if (!list.ok) return;

  assert.equal((await addToList(list.value.id, first.email)).ok, true);
  assert.equal((await addToList(list.value.id, unsubscribed.email)).ok, true);

  const campaign = await db.emailCampaign.create({
    data: {
      name: `Opening ${nextKey()}`,
      subject: 'Ordering is open',
      body: 'The season is open.',
      listId: list.value.id,
    },
  });

  // The list holds two people but one of them left the newsletter.
  assert.equal(await countAudience(campaign), 1);

  const sent = await sendCampaign(campaign.id);
  assert.equal(sent.ok && sent.value.queued, 1);

  const again = await sendCampaign(campaign.id);
  assert.equal(again.ok && again.value.queued, 0);
  assert.equal(again.ok && again.value.alreadySent, 1);

  assert.equal(await db.emailCampaignSend.count({ where: { campaignId: campaign.id } }), 1);
  assert.equal(
    await db.notificationLog.count({ where: { kind: 'campaign.send', destination: second.email } }),
    0,
    'somebody off the list is never written to',
  );

  const queued = await db.notificationLog.findUniqueOrThrow({
    where: { dedupeKey: `campaign:${campaign.id}:${first.id}` },
  });
  assert.ok(
    queued.body.includes('/newsletter/manage?token='),
    'every campaign carries its own way out',
  );
});
