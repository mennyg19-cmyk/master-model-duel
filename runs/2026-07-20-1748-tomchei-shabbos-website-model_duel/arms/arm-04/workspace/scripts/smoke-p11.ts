import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { findForm, parseForms, Session } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import { cartLines, dollars, formWith, redirectOf } from './smoke-p4-helpers';
import { flashOf } from './smoke-p10-helpers';
import { MAX_DELIVERY_ATTEMPTS } from '../src/lib/notifications/dispatch';
import { REDACTED_BODY } from '../src/lib/notifications/purge';

/**
 * Phase P11 smoke run: the email platform, driven over HTTP against the running
 * app.
 *
 * Nothing here reaches a mail provider. `EMAIL_PROVIDER=capture` writes every
 * outgoing message into `CapturedMessage` instead, which is what makes it
 * possible to check what a donor would have received rather than only that a
 * row was written — and the capture provider refuses any address beginning
 * "bounce", so a real provider failure can be forced without a network.
 *
 * Against the EXPECTED table: S1 → S1a–S1b, S2 → S2a–S2g, S3 → S3a–S3f,
 * S4 → S4a–S4c, S5 → S5a–S5c plus S5a2 and S5b2.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER ?? 'capture';

const MANAGER_EMAIL = 'manager@tomchei.example';
const BASKET = 'deluxe-wine-basket';

const EMAIL_HUB = '/admin/email';
const LISTS = '/admin/email/lists';
const OUTBOX = '/admin/email/outbox';
const TEMPLATES = '/admin/email/templates';
const EMAIL_SETTINGS = '/admin/settings/email';

const SWEEP_URL = '/api/cron/notification-sweep';
const PURGE_URL = '/api/cron/email-log-purge';

const TEST_FILES = ['tests/email.test.ts', 'tests/newsletter.test.ts'];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const stamp = Date.now().toString(36);

const run = new SmokeRun('P11', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  '',
  `EMAIL_PROVIDER=${EMAIL_PROVIDER}: every message below is written to CapturedMessage`,
  'rather than posted to Resend, so the checks read what a donor would have',
  'received. Provider failure is forced the same honest way — the capture',
  'provider refuses any address beginning "bounce" — so the retry ladder and its',
  'failure trail are real rather than mocked.',
  '',
  'EXPECTED smoke rows map onto these checks as: S1 → S1a–S1b, S2 → S2a–S2g,',
  'S3 → S3a–S3f, S4 → S4a–S4c, S5 → S5a–S5c plus S5a2 and S5b2.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  const season = await db.season.findFirstOrThrow({
    where: { status: 'OPEN' },
    orderBy: { year: 'desc' },
  });
  const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
  const pickupMethodId = methods.find((row) => row.code === 'pickup')!.id;
  const pickup = await db.pickupLocation.findFirstOrThrow({ where: { isActive: true } });

  await db.order.deleteMany({ where: { status: 'DRAFT' } });

  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);

  // The sender is the gate in front of every email, so it is set through the
  // page that owns it before anything is queued.
  const settingsPage = await manager.get(EMAIL_SETTINGS);
  await manager.submit(formWith(settingsPage.body, EMAIL_SETTINGS, 'name="fromName"'), {
    fromName: 'Tomchei Shabbos',
    fromAddress: 'office@tomchei.example',
    replyToAddress: 'office@tomchei.example',
  });

  // ------------------------------------------ S1 the newsletter and its tokens
  const readerEmail = `reader-${stamp}@example.test`;
  const leaverEmail = `leaver-${stamp}@example.test`;

  const visitor = new Session(BASE_URL);
  await subscribeFromFooter(visitor, readerEmail);
  await subscribeFromFooter(visitor, leaverEmail);

  const managePath = pathOf(newsletterLink(readerEmail));
  const managePage = await visitor.get(managePath);
  const preferencesForm = findForm(parseForms(managePage.body, managePath), {
    'preferences-present': '1',
  });
  await visitor.submit(preferencesForm, {
    wantsSeasonAnnouncements: 'on',
    wantsOrderReminders: '',
    wantsImpactStories: 'on',
  });
  const reader = await db.newsletterSubscriber.findUniqueOrThrow({
    where: { normalizedEmail: readerEmail },
  });

  expect('S1a', 'A signed link sets each preference on its own, with no session',
    managePage.status === 200 &&
      reader.status === 'SUBSCRIBED' &&
      reader.wantsSeasonAnnouncements &&
      !reader.wantsOrderReminders &&
      reader.wantsImpactStories,
    `${readerEmail} opened /newsletter/manage?token=… -> ${managePage.status} and saved announcements=on, reminders=off, stories=on`);

  const tampered = await visitor.get(`${managePath}x`);
  const leaverPath = pathOf(newsletterLink(leaverEmail));
  const leaverPage = await visitor.get(leaverPath);
  await visitor.submit(formWith(leaverPage.body, leaverPath, 'Prefer no email at all?'));
  const leaver = await db.newsletterSubscriber.findUniqueOrThrow({
    where: { normalizedEmail: leaverEmail },
  });

  expect('S1b', 'A tampered token is refused, and leaving keeps the row that proves it',
    tampered.body.includes('data-testid="token-error"') &&
      leaver.status === 'UNSUBSCRIBED' &&
      leaver.unsubscribedAt !== null,
    `one character appended to the signature renders the token error; ${leaverEmail} reads UNSUBSCRIBED with unsubscribedAt ${leaver.unsubscribedAt?.toISOString()}, row kept`);

  // ---------------------------------------------------------- S2 the campaign
  const listsPage = await manager.get(LISTS);
  const listName = `Gabbaim ${stamp}`;
  await manager.submit(formWith(listsPage.body, LISTS, 'placeholder="Shul gabbaim"'), {
    name: listName,
    description: 'One contact per shul',
  });
  const list = await db.subscriberList.findFirstOrThrow({ where: { name: listName } });

  await addToList(manager, list.id, readerEmail);
  const refusedAdd = await addToList(manager, list.id, `stranger-${stamp}@example.test`);
  await addToList(manager, list.id, leaverEmail);

  const members = await db.subscriberListMember.count({ where: { listId: list.id } });

  expect('S2a', 'A list is built from the newsletter, and only from the newsletter',
    members === 2 && refusedAdd.includes('not on the newsletter list'),
    `${listName} holds ${members} members; an address nobody subscribed is refused with "${refusedAdd}"`);

  const hub = await manager.get(EMAIL_HUB);
  const campaignName = `Opening ${stamp}`;
  const draftLocation = redirectOf(
    await manager.submit(formWith(hub.body, EMAIL_HUB, 'placeholder="Purim 2027 opening"'), {
      name: campaignName,
      subject: 'Ordering is open',
      body: 'The season is open. Order at https://tomchei.example/order',
      listId: list.id,
      preferenceKey: 'wantsSeasonAnnouncements',
    }),
    'saving a draft',
  );

  const campaignPath = pathOf(draftLocation);
  const campaignPage = await manager.get(campaignPath);
  const campaign = await db.emailCampaign.findFirstOrThrow({ where: { name: campaignName } });

  const audienceCount = attributeOf(campaignPage.body, 'campaign-audience', 'count');

  expect('S2b', 'A draft is saved with its audience and previewed before anybody is written to',
    campaign.status === 'DRAFT' &&
      campaignPage.body.includes('data-testid="campaign-preview"') &&
      campaignPage.body.includes('/newsletter/manage?token=') &&
      audienceCount === 1,
    `"${campaignName}" saved as ${campaign.status} for ${listName} + season announcements; the preview shows the letter with its own unsubscribe link, and the page counts ${audienceCount} address — the member who left is not in it`);

  const testAddress = `desk-${stamp}@example.test`;
  const testLocation = redirectOf(
    await manager.submit(formWith(campaignPage.body, campaignPath, 'name="destination"'), {
      destination: testAddress,
    }),
    'sending a test',
  );
  const testCapture = await db.capturedMessage.findFirstOrThrow({
    where: { destination: testAddress },
    orderBy: { capturedAt: 'desc' },
  });
  const queuedByTest = await db.notificationLog.count({ where: { destination: testAddress } });

  expect('S2c', 'A test send goes to one desk and queues nothing for the list',
    testCapture.subject?.startsWith('[test]') === true &&
      testCapture.source === 'campaign-test' &&
      queuedByTest === 0 &&
      flashOf(testLocation, 'notice').includes('captured'),
    `"${flashOf(testLocation, 'notice')}" — one captured message titled "${testCapture.subject}" for ${testAddress}, and ${queuedByTest} rows in the outbox`);

  const sentLocation = redirectOf(
    await manager.submit(formWith((await manager.get(campaignPath)).body, campaignPath, 'Send to the list')),
    'sending the campaign',
  );
  const afterSend = await db.emailCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
  const sends = await db.emailCampaignSend.findMany({ where: { campaignId: campaign.id } });
  const sentAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'email.campaign_sent', entityId: campaign.id },
  });

  expect('S2d', 'Sending queues one message per recipient and says so in the audit',
    afterSend.status === 'SENT' &&
      sends.length === 1 &&
      flashOf(sentLocation, 'notice').startsWith('1 queued') &&
      (sentAudit.detail as { queued?: number }).queued === 1,
    `"${flashOf(sentLocation, 'notice')}" — campaign ${afterSend.status}, ${sends.length} send row, audit "${sentAudit.action}" by ${sentAudit.actorLabel}`);

  const rerunLocation = redirectOf(
    await manager.submit(formWith((await manager.get(campaignPath)).body, campaignPath, 'Send to anyone new')),
    'sending the campaign again',
  );
  const afterRerun = await db.emailCampaignSend.count({ where: { campaignId: campaign.id } });
  const campaignMessages = await db.notificationLog.count({
    where: { kind: 'campaign.send', dedupeKey: { startsWith: `campaign:${campaign.id}:` } },
  });
  const leaverWritten = await db.notificationLog.count({ where: { destination: leaverEmail } });

  expect('S2e', 'Sending the same campaign again writes to nobody twice',
    flashOf(rerunLocation, 'notice').startsWith('0 queued') &&
      afterRerun === 1 &&
      campaignMessages === 1 &&
      leaverWritten === 0,
    `second send answered "${flashOf(rerunLocation, 'notice')}"; still ${afterRerun} send row and ${campaignMessages} queued message, and the unsubscribed member has ${leaverWritten}`);

  await sweep();
  const campaignMessage = await db.notificationLog.findFirstOrThrow({
    where: { dedupeKey: `campaign:${campaign.id}:${reader.id}` },
  });
  const delivered = await db.capturedMessage.findUniqueOrThrow({
    where: { id: campaignMessage.providerReference ?? '' },
  });

  expect('S2f', 'The sweeper delivers the letter the preview promised, unsubscribe link and all',
    campaignMessage.status === 'SENT' &&
      delivered.destination === readerEmail &&
      delivered.body.includes('/newsletter/manage?token=') &&
      delivered.subject === 'Ordering is open',
    `${readerEmail} received "${delivered.subject}" carrying its own way out; the outbox row is ${campaignMessage.status} after ${campaignMessage.attempts} attempt`);

  // The state a send that died mid-list leaves behind. The office has to be
  // able to see it and press through it rather than find a campaign that reads
  // as a draft and cannot be edited.
  await db.emailCampaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' } });
  const hubMidSend = await manager.get(EMAIL_HUB);
  const campaignMidSend = await manager.get(campaignPath);
  const resumeLocation = redirectOf(
    await manager.submit(formWith(campaignMidSend.body, campaignPath, 'Send to anyone new')),
    'finishing an interrupted send',
  );
  const afterResume = await db.emailCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
  const sendsAfterResume = await db.emailCampaignSend.count({ where: { campaignId: campaign.id } });

  expect('S2g', 'A campaign caught mid-send says so on both screens, and pressing Send finishes it',
    hubMidSend.body.includes('data-status="SENDING"') &&
      campaignMidSend.body.includes('>Sending<') &&
      afterResume.status === 'SENT' &&
      sendsAfterResume === 1,
    `the hub row reads data-status="SENDING" and the campaign page shows a Sending badge; pressing Send answered "${flashOf(resumeLocation, 'notice')}" and left the campaign ${afterResume.status} with ${sendsAfterResume} send row — nobody written to twice`);

  // -------------------------------------------- S3 transactional and failure
  const donorEmail = `donor-${stamp}@example.test`;
  const donorOrder = await buyOneBasket(donorEmail, 'Shprintza Fried', pickupMethodId, pickup.id, season.id);

  const refundPath = `/admin/orders/${donorOrder.id}`;
  const desk = await manager.get(refundPath);
  await manager.submit(formWith(desk.body, refundPath, 'data-testid="payment-refund"'), {
    amount: '5.00',
    reason: 'One box we could not fill',
  });

  const donorMessages = await db.notificationLog.findMany({
    where: { destination: donorEmail },
    orderBy: { createdAt: 'asc' },
  });
  const kinds = donorMessages.map((message) => message.kind);

  expect('S3a', 'Placing, paying for and refunding an order each write their own email',
    kinds.includes('order.confirmation') &&
      kinds.includes('order.payment_link') &&
      kinds.includes('order.refund'),
    `${donorEmail} has ${donorMessages.length} queued messages: ${kinds.join(', ')} — each keyed to the event that caused it (${donorMessages.map((message) => message.dedupeKey.split(':')[0]).join(', ')})`);

  await sweep();
  const afterFirstSweep = await db.notificationLog.findMany({
    where: { destination: donorEmail },
    include: { attemptTrail: true },
  });
  const confirmation = afterFirstSweep.find((message) => message.kind === 'order.confirmation')!;
  const confirmationBody = await db.capturedMessage.findUniqueOrThrow({
    where: { id: confirmation.providerReference ?? '' },
  });

  await sweep();
  const afterSecondSweep = await db.notificationLog.findMany({ where: { destination: donorEmail } });
  const capturedForDonor = await db.capturedMessage.count({ where: { destination: donorEmail } });

  expect('S3b', 'Each transactional email is delivered exactly once, however often the sweeper runs',
    afterFirstSweep.every((message) => message.status === 'SENT' && message.attempts === 1) &&
      afterSecondSweep.every((message) => message.attempts === 1) &&
      capturedForDonor === donorMessages.length,
    `${afterFirstSweep.length} messages sent on the first sweep, all still at 1 attempt after a second; ${capturedForDonor} letters in the donor's inbox, one per event`);

  expect('S3c', 'The letter carries the customer\u2019s own words filled into the template',
    confirmationBody.subject === 'We have your order, Shprintza Fried' &&
      confirmationBody.body.includes(dollars(donorOrder.totalCents)) &&
      !confirmationBody.body.includes('{{'),
    `"${confirmationBody.subject}" quotes ${dollars(donorOrder.totalCents)} for ${donorOrder.orderNumber === null ? 'the order' : `order #${donorOrder.orderNumber}`}, with every placeholder filled`);

  // A donor whose address the provider refuses. Nothing is mocked: the capture
  // provider rejects it the way Resend rejects a dead mailbox.
  const bounceEmail = `bounce-${stamp}@example.test`;
  await buyOneBasket(bounceEmail, 'Bounced Donor', pickupMethodId, pickup.id, season.id);

  await sweep();
  const firstFailure = await db.notificationLog.findFirstOrThrow({
    where: { destination: bounceEmail, kind: 'order.confirmation' },
    include: { attemptTrail: true },
  });

  await sweep();
  const heldBack = await db.notificationLog.findFirstOrThrow({
    where: { id: firstFailure.id },
    include: { attemptTrail: true },
  });

  expect('S3d', 'A refused message is kept, dated for a later try, and not hammered in between',
    firstFailure.status === 'QUEUED' &&
      firstFailure.attempts === 1 &&
      firstFailure.nextAttemptAt !== null &&
      firstFailure.lastError !== null &&
      heldBack.attempts === 1,
    `the provider refused ${bounceEmail} with "${firstFailure.lastError}"; the row stays QUEUED, due again at ${firstFailure.nextAttemptAt?.toISOString()}, and an immediate second sweep leaves it at ${heldBack.attempts} attempt`);

  // Only the clock is moved: each sweep is made due, and the ladder runs to its end.
  for (let attempt = 2; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    await db.notificationLog.update({
      where: { id: firstFailure.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await sweep();
  }

  const givenUp = await db.notificationLog.findFirstOrThrow({
    where: { id: firstFailure.id },
    include: { attemptTrail: { orderBy: { attempt: 'asc' } } },
  });
  const bounceCaptured = await db.capturedMessage.count({ where: { destination: bounceEmail } });

  expect('S3e', 'After five refusals the message is given up on, with every attempt on the record',
    givenUp.status === 'FAILED' &&
      givenUp.attempts === MAX_DELIVERY_ATTEMPTS &&
      givenUp.attemptTrail.length === MAX_DELIVERY_ATTEMPTS &&
      givenUp.attemptTrail.every((row) => row.outcome === 'FAILED') &&
      givenUp.failedAt !== null &&
      bounceCaptured === 0,
    `${MAX_DELIVERY_ATTEMPTS} attempts recorded (${givenUp.attemptTrail.map((row) => `#${row.attempt} ${row.outcome.toLowerCase()}`).join(', ')}), status ${givenUp.status} at ${givenUp.failedAt?.toISOString()}, nothing delivered`);

  const outboxPage = await manager.get(OUTBOX);
  const templatesPage = await manager.get(TEMPLATES);
  record('S3f', 'The failure is readable by the office, not only in the database',
    outboxPage.body.includes(bounceEmail) &&
      outboxPage.body.includes('data-status="FAILED"') &&
      templatesPage.body.includes('data-key="order.confirmation"'),
    `${OUTBOX} shows ${bounceEmail} as FAILED with its attempt count; ${TEMPLATES} offers the wording of each triggered email`);

  // -------------------------------------------------- S4 cron auth and overlap
  const guarded: string[] = [];
  for (const url of [SWEEP_URL, PURGE_URL]) {
    const bare = await fetch(new URL(url, BASE_URL), { method: 'POST' });
    const wrong = await fetch(new URL(url, BASE_URL), {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-secret' },
    });
    const right = await fetch(new URL(url, BASE_URL), {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    guarded.push(`${url} -> ${bare.status}/${wrong.status}/${right.status}`);
    if (bare.status !== 401 || wrong.status !== 401 || right.status !== 200) {
      throw new Error(`${url} answered ${bare.status}/${wrong.status}/${right.status}`);
    }
  }

  expect('S4a', 'Both new cron endpoints refuse a missing or wrong secret and answer the right one',
    guarded.length === 2,
    `no header / wrong secret / correct secret: ${guarded.join('; ')}`);

  // Several messages, then several sweeps at once: the claim is per message.
  const crowd = await Promise.all(
    ['aleph', 'beis', 'gimmel', 'daled'].map((name) => subscribeFromFooter(visitor, `${name}-${stamp}@example.test`)),
  );
  for (const address of crowd) await addToList(manager, list.id, address);

  const secondHub = await manager.get(EMAIL_HUB);
  const raceName = `Reminder ${stamp}`;
  const racePath = pathOf(
    redirectOf(
      await manager.submit(formWith(secondHub.body, EMAIL_HUB, 'placeholder="Purim 2027 opening"'), {
        name: raceName,
        subject: 'One week to order',
        body: 'A week left to order.',
        listId: list.id,
        preferenceKey: '',
      }),
      'saving the second draft',
    ),
  );
  await manager.submit(formWith((await manager.get(racePath)).body, racePath, 'Send to the list'));
  const raceCampaign = await db.emailCampaign.findFirstOrThrow({ where: { name: raceName } });

  const queuedBefore = await db.notificationLog.count({
    where: { dedupeKey: { startsWith: `campaign:${raceCampaign.id}:` }, status: 'QUEUED' },
  });
  const concurrent = await Promise.all([sweep(), sweep(), sweep()]);
  const raced = await db.notificationLog.findMany({
    where: { dedupeKey: { startsWith: `campaign:${raceCampaign.id}:` } },
    include: { attemptTrail: true },
  });

  const sentByRace = concurrent.reduce((total, summary) => total + summary.sent, 0);

  expect('S4b', 'Three sweeps at once claim each message once between them',
    queuedBefore > 1 &&
      raced.every((message) => message.status === 'SENT' && message.attemptTrail.length === 1) &&
      sentByRace >= queuedBefore,
    `${queuedBefore} messages queued; three concurrent sweeps sent ${concurrent.map((summary) => summary.sent).join(' + ')} = ${sentByRace} between them, and each of the ${raced.length} messages carries exactly one delivery attempt`);

  const sweepRuns = await db.cronRunLog.count({ where: { jobName: 'notifications.outbox-sweep' } });
  const purgeRuns = await db.cronRunLog.count({ where: { jobName: 'notifications.log-purge' } });
  record('S4c', 'Every sweep and purge leaves its own run row',
    sweepRuns >= 3 && purgeRuns >= 1,
    `${sweepRuns} outbox-sweep runs and ${purgeRuns} log-purge runs recorded in CronRunLog`);

  // ------------------------------------------------- S5 the purge and capture
  const deskAddress = `office-${stamp}@example.test`;
  const settingsForTest = await manager.get(EMAIL_SETTINGS);
  const testSend = redirectOf(
    await manager.submit(formWith(settingsForTest.body, EMAIL_SETTINGS, 'data-testid="send-test-email"'), {
      destination: deskAddress,
    }),
    'sending a test from settings',
  );
  const deskCapture = await db.capturedMessage.findFirstOrThrow({
    where: { destination: deskAddress },
  });
  const deskQueued = await db.notificationLog.count({ where: { destination: deskAddress } });
  const testAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'email.test_sent', entityId: 'email.fromAddress' },
    orderBy: { createdAt: 'desc' },
  });

  expect('S5a', 'The settings test sender proves the account without touching a provider or the queue',
    deskCapture.source === 'settings-test' &&
      deskQueued === 0 &&
      flashOf(testSend, 'notice').includes('capture') &&
      (testAudit.detail as { provider?: string }).provider === 'capture',
    `"${flashOf(testSend, 'notice')}" — captured as ${deskCapture.source}, ${deskQueued} outbox rows, audited as "${testAudit.action}"`);

  // Retention is set through the page that owns it, then the clock is moved
  // back on what has already been delivered.
  const brandingPage = await manager.get(EMAIL_SETTINGS);
  await manager.submit(formWith(brandingPage.body, EMAIL_SETTINGS, 'name="logRetentionDays"'), {
    logoUrl: '',
    footerText: 'Tomchei Shabbos · office@tomchei.example',
    accentColor: '#8a1c1c',
    logRetentionDays: '30',
  });

  const logoRejection = redirectOf(
    await manager.submit(formWith(brandingPage.body, EMAIL_SETTINGS, 'name="logRetentionDays"'), {
      logoUrl: 'javascript:alert(1)',
      footerText: 'Tomchei Shabbos · office@tomchei.example',
      accentColor: '#8a1c1c',
      logRetentionDays: '30',
    }),
    'saving a logo address that is not a picture',
  );
  const rejectionPage = await manager.get(pathOf(logoRejection));
  const storedLogo = await db.setting.findUnique({ where: { key: 'email.logoUrl' } });

  expect('S5a2', 'A logo address the browser would run is refused, and the refusal is shown the one way every screen shows one',
    logoRejection.includes('problem=') &&
      flashOf(logoRejection, 'problem').startsWith('The logo has to be') &&
      rejectionPage.body.includes('data-testid="email-settings-problem"') &&
      (storedLogo?.value ?? '') === '',
    `"javascript:alert(1)" came back as "${flashOf(logoRejection, 'problem')}" on ?problem=, rendered by the shared flash alert, and nothing was written to email.logoUrl`);

  const longAgo = new Date(Date.now() - 400 * 86_400_000);
  const aged = await db.notificationLog.updateMany({
    where: { status: 'SENT', dedupeKey: { startsWith: `campaign:${raceCampaign.id}:` } },
    data: { sentAt: longAgo, createdAt: longAgo },
  });

  const auditsBefore = await db.auditEvent.count();
  const queuedBeforePurge = await db.notificationLog.count({ where: { status: 'QUEUED' } });
  const purgeResponse = await fetch(new URL(PURGE_URL, BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const purgeBody = (await purgeResponse.json()) as { retentionDays: number; messages: number };

  const survivingFailure = await db.notificationLog.count({ where: { id: firstFailure.id } });
  const purgedCampaign = await db.notificationLog.count({
    where: { dedupeKey: { startsWith: `campaign:${raceCampaign.id}:` } },
  });
  const auditsAfter = await db.auditEvent.count();
  const queuedAfterPurge = await db.notificationLog.count({ where: { status: 'QUEUED' } });

  expect('S5b', 'The purge takes delivered mail past its keep-by date and nothing else',
    purgeBody.retentionDays === 30 &&
      purgeBody.messages >= aged.count &&
      purgedCampaign === 0 &&
      survivingFailure === 1 &&
      auditsAfter === auditsBefore &&
      queuedAfterPurge === queuedBeforePurge,
    `retention ${purgeBody.retentionDays} days: ${purgeBody.messages} delivered messages older than that were deleted, while the failed one, ${queuedAfterPurge} queued rows and all ${auditsAfter} audit events stayed`);

  // The failure survived the purge above because it is recent. Aged past the
  // same window, the row is still there to answer for and the donor's text is
  // not.
  await db.notificationLog.update({
    where: { id: firstFailure.id },
    data: { failedAt: longAgo, createdAt: longAgo },
  });
  await fetch(new URL(PURGE_URL, BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const agedFailure = await db.notificationLog.findUniqueOrThrow({ where: { id: firstFailure.id } });

  expect('S5b2', 'A failure nobody answered keeps its row past the window and loses the donor\u2019s words',
    agedFailure.status === 'FAILED' &&
      agedFailure.body === REDACTED_BODY &&
      agedFailure.subject === null &&
      agedFailure.lastError !== null,
    `the row for ${agedFailure.destination} is still FAILED with its last provider error "${agedFailure.lastError}", and its body now reads "${agedFailure.body}"`);

  const capturedTotal = await db.capturedMessage.count();
  record('S5c', 'Nothing in this run reached a mail or SMS provider',
    EMAIL_PROVIDER === 'capture' && capturedTotal > 0,
    `EMAIL_PROVIDER=${EMAIL_PROVIDER}, SMS_PROVIDER=${process.env.SMS_PROVIDER ?? 'capture'}; ${capturedTotal} messages readable in CapturedMessage and none posted anywhere`);

  // --------------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P11-1', 'Templates, branding and the sender gate are covered by unit tests', passedTests, [
    'a triggered email uses the shipped wording until it is overridden',
    'a placeholder the app cannot fill is named before it is saved',
    'the letterhead escapes what a donor typed and links what they wrote',
    'the sender line is blank until an address is configured',
  ]);

  expectTest('P11-2', 'The outbox, its retries and the purge are covered by unit tests', passedTests, [
    'the sweeper sends a queued message once and records how it went',
    'a refused message backs off, keeps a trail and is given up on after five tries',
    'a message that is not due yet is left where it is',
    'email waits for a sender address while texts still go out',
    'the purge takes delivered mail and leaves everything still owed',
    'a campaign reaches its audience once, however many times it is sent',
  ]);

  record('P11-3', 'The P11 test files are green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const lint = runCommand('npm', ['run', 'lint'], envWithoutDatabaseUrl());
  const types = runCommand('npm', ['run', 'typecheck'], envWithoutDatabaseUrl());
  record('P11-4', 'Lint and types are clean', lint.status === 0 && types.status === 0,
    `eslint exit ${lint.status}, tsc exit ${types.status}`);

  run.write();
}

type SweepSummary = { claimed: number; sent: number; retrying: number; failed: number };

async function sweep(): Promise<SweepSummary> {
  const response = await fetch(new URL(SWEEP_URL, BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!response.ok) throw new Error(`The sweep answered ${response.status}`);

  return (await response.json()) as SweepSummary;
}

async function subscribeFromFooter(session: Session, email: string): Promise<string> {
  const home = await session.get('/');
  await session.submit(findForm(parseForms(home.body, '/'), { source: 'footer' }), { email });
  return email;
}

async function addToList(session: Session, listId: string, email: string): Promise<string> {
  const page = await session.get(LISTS);
  const form = formWith(page.body, LISTS, `id="email-${listId}"`);

  const location = redirectOf(await session.submit(form, { listId, email }), `adding ${email}`);
  return flashOf(location, 'notice') || flashOf(location, 'problem');
}

function attributeOf(html: string, testId: string, attribute: string): number {
  const section = html.slice(html.indexOf(`data-testid="${testId}"`));
  return Number(new RegExp(`data-${attribute}="(-?\\d+)"`).exec(section)?.[1] ?? -1);
}

/** One basket, paid for on the hosted page — the shortest path to a real order. */
async function buyOneBasket(
  email: string,
  fullName: string,
  fulfillmentMethodId: string,
  pickupLocationId: string,
  seasonId: string,
): Promise<{ id: string; orderNumber: number | null; totalCents: number }> {
  const buyer = new Session(BASE_URL);
  const builder = await buyer.get('/order');
  const addForm = parseForms(builder.body, '/order').find((form) => form.fields.slug === BASKET);
  if (!addForm) throw new Error(`No add form for ${BASKET} on the builder`);
  redirectOf(await buyer.submit(addForm, { quantity: '1' }), `adding ${BASKET}`);

  const line = cartLines((await buyer.get('/order')).body)[0];
  const assignPath = `/order?assign=${line.id}`;
  const assignPage = await buyer.get(assignPath);
  redirectOf(
    await buyer.submit(formWith(assignPage.body, assignPath, 'data-testid="assign-submit"'), {
      lineId: line.id,
      target: 'self',
      recipientName: fullName,
      fulfillmentMethodId,
      pickupLocationId,
    }),
    'assigning the box',
  );

  const checkout = await buyer.get('/order/checkout');
  const hostedPath = pathOf(
    redirectOf(
      await buyer.submit(formWith(checkout.body, '/order/checkout', 'data-testid="checkout-pay"'), {
        fullName,
        email,
        phone: '',
      }),
      'paying',
    ),
  );

  const hosted = await buyer.get(hostedPath);
  redirectOf(
    await buyer.submit(formWith(hosted.body, hostedPath, 'data-testid="hosted-pay"')),
    'confirming the payment',
  );

  const order = await db.order.findFirstOrThrow({
    where: { seasonId, customer: { normalizedEmail: email } },
    orderBy: { placedAt: 'desc' },
  });

  // The refund desk needs the money to have landed before it can hand any back.
  if (order.paymentStatus !== 'PAID') {
    throw new Error(`${email}'s order is ${order.paymentStatus} rather than PAID`);
  }

  return { id: order.id, orderNumber: order.orderNumber, totalCents: order.totalCents };
}

function pathOf(url: string): string {
  const parsed = new URL(url, BASE_URL);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * The signed preferences link, taken from the script a developer would use
 * rather than re-derived here, so the run cannot pass with a token the app
 * would not have issued.
 */
function newsletterLink(email: string): string {
  const printed = runCommand('node', [
    '--import', 'tsx',
    '--conditions=react-server',
    '--env-file=.env',
    'scripts/newsletter-link.ts',
    email,
  ]);

  const url = printed.output.split('\n').find((line) => line.includes('/newsletter/manage?token='));
  if (!url) throw new Error(`No preferences link printed for ${email}: ${printed.output}`);
  return url.trim();
}

async function signInStaff(session: Session, email: string) {
  session.clearCookies();
  const page = await session.get('/sign-in');
  const response = await session.submit(parseForms(page.body, '/sign-in')[0], { email });
  if (response.status !== 303) throw new Error(`Staff sign-in for ${email} returned ${response.status}`);
}

main()
  .catch((error) => {
    console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
    run.write();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
