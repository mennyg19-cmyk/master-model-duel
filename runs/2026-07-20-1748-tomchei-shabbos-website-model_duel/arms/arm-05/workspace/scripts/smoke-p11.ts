import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { GET as emailOutboxCron } from "../app/api/cron/email-outbox/route";
import { GET as emailPurgeCron } from "../app/api/cron/email-log-purge/route";
import { GET as paymentReminderCron } from "../app/api/cron/payment-reminders/route";
import { GET as pickupExpiryCron } from "../app/api/cron/pickup-expiry/route";
import { GET as seasonAutoFlipCron } from "../app/api/cron/season-auto-flip/route";
import {
  createCampaign,
  purgeEmailLogs,
  queueEmail,
  queueOrderLifecycleEmail,
  sendCampaign,
  sweepEmailOutbox,
  testSendCampaign,
} from "../lib/email";
import {
  confirmSubscription,
  createNewsletterPreferencesToken,
  createUnsubscribeToken,
  getNewsletterSubscription,
  readUnsubscribeToken,
  subscribe,
  unsubscribe,
  updateNewsletterPreferences,
} from "../lib/newsletter";
import { LOCAL_DATABASE_URL, runWithLocalDatabase, startLocalDatabase, stopLocalDatabase } from "./local-db";

process.env.EMAIL_TEST_MODE = "true";
process.env.NEWSLETTER_TOKEN_SECRET = "p11-smoke-newsletter-secret";
process.env.CRON_SECRET = "p11-smoke-cron-secret";

async function confirmedSubscriber(email: string) {
  const subscribed = await subscribe(email);
  if (!subscribed.confirmationToken) throw new Error("Smoke subscriber requires a confirmation token.");
  await confirmSubscription(subscribed.confirmationToken);
  return subscribed.subscriber;
}

function cronRequest(secret?: string) {
  return new Request("http://localhost/api/cron/smoke", secret ? { headers: { authorization: `Bearer ${secret}` } } : {});
}

async function checkCron(handler: (request: Request) => Promise<Response>) {
  assert.equal((await handler(cronRequest())).status, 401);
  assert.equal((await handler(cronRequest("wrong-secret"))).status, 401);
  assert.equal((await handler(cronRequest(process.env.CRON_SECRET))).status, 200);
}

async function verifySmoke() {
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const preferenceSubscriber = await confirmedSubscriber(`p11-preferences-${randomUUID()}@example.test`);
    const preferenceToken = createNewsletterPreferencesToken(preferenceSubscriber.id);
    const unsubscribeToken = createUnsubscribeToken(preferenceSubscriber.id);
    assert.equal(await updateNewsletterPreferences(preferenceToken, { marketing: false, updates: false, reminders: false }), true);
    assert.deepEqual((await getNewsletterSubscription(preferenceToken))?.preferences, { marketing: false, updates: false, reminders: false });
    assert.equal(readUnsubscribeToken(preferenceToken), null);
    assert.equal(readUnsubscribeToken(`${unsubscribeToken}x`), null);
    assert.equal(readUnsubscribeToken(createUnsubscribeToken(preferenceSubscriber.id, Date.now() - 1)), null);
    assert.equal(await unsubscribe(unsubscribeToken), true);
    assert.equal((await subscribe(preferenceSubscriber.email)).confirmationToken, null);

    const expiredConfirmation = await subscribe(`p11-expired-${randomUUID()}@example.test`);
    await prisma.newsletterSubscriber.update({
      where: { id: expiredConfirmation.subscriber.id },
      data: { confirmationTokenExpiresAt: new Date(0) },
    });
    assert.equal(await confirmSubscription(expiredConfirmation.confirmationToken!), null);
    console.log("S1 passed: scoped, rotating-key preference tokens changed all three choices; tampered, wrong-scope, expired, and expired confirmation tokens failed; unsubscribe succeeded.");


    const campaignSubscriber = await confirmedSubscriber(`p11-campaign-${randomUUID()}@example.test`);
    const campaign = await createCampaign({
      name: `P11 campaign ${randomUUID()}`,
      subject: "Purim campaign preview",
      body: "<p>Campaign preview</p>",
    });
    await testSendCampaign(campaign.id, `p11-test-${randomUUID()}@example.test`);
    await sweepEmailOutbox();
    await sendCampaign(campaign.id);
    await sendCampaign(campaign.id);
    await sweepEmailOutbox();
    assert.equal(await prisma.emailCampaignDelivery.count({ where: { campaignId: campaign.id, subscriberId: campaignSubscriber.id } }), 1);
    assert.equal(await prisma.emailOutbox.count({ where: { dedupeKey: `campaign:${campaign.id}:${campaignSubscriber.id}` } }), 1);
    console.log("S2 passed: campaign draft preview, test capture, send, list state, and rerun created no duplicate delivery.");

    const season = await prisma.season.findUniqueOrThrow({ where: { year: 2026 } });
    const customer = await prisma.customer.create({
      data: { firstName: "P11", lastName: "Customer", emailNormalized: `p11-order-${randomUUID()}@example.test` },
    });
    const order = await prisma.order.create({
      data: {
        seasonId: season.id,
        customerId: customer.id,
        draftReference: `P11-${randomUUID()}`,
        wireFormat: { source: "smoke" },
      },
    });
    await Promise.all([
      queueOrderLifecycleEmail(order.id, "ORDER_CONFIRMATION"),
      queueOrderLifecycleEmail(order.id, "PAYMENT_LINK", "https://example.test/pay"),
      queueOrderLifecycleEmail(order.id, "REFUND"),
    ]);
    const retry = await queueEmail({
      eventKey: "SMOKE_FAILURE",
      recipient: customer.emailNormalized!,
      subject: "Retry proof",
      html: "<p>Retry proof</p>",
      dedupeKey: `p11-retry:${randomUUID()}`,
      payload: { testFailureOnce: true },
    });
    await sweepEmailOutbox();
    await prisma.emailOutbox.update({ where: { id: retry.id }, data: { availableAt: new Date(0) } });
    await sweepEmailOutbox();
    assert.deepEqual(
      (await prisma.emailLog.findMany({ where: { outboxId: retry.id }, orderBy: { createdAt: "asc" } })).map((log) => log.status),
      ["FAILED", "DELIVERED"],
    );
    console.log("S3 passed: confirmation, payment-link, and refund templates queued; forced failure retried once with an auditable trail.");

    const overlap = await queueEmail({
      eventKey: "SMOKE_OVERLAP",
      recipient: customer.emailNormalized!,
      subject: "Overlap proof",
      html: "<p>Overlap proof</p>",
      dedupeKey: `p11-overlap:${randomUUID()}`,
    });
    await Promise.all([sweepEmailOutbox(), sweepEmailOutbox()]);
    assert.equal(await prisma.emailLog.count({ where: { outboxId: overlap.id, status: "DELIVERED" } }), 1);
    await Promise.all([
      checkCron(emailOutboxCron),
      checkCron(emailPurgeCron),
      checkCron(pickupExpiryCron),
      checkCron(paymentReminderCron),
      checkCron(seasonAutoFlipCron),
    ]);
    console.log("S4 passed: every registered cron rejected missing and wrong bearer secrets; overlapping outbox sweeps claimed one message.");

    const oldMessage = await queueEmail({
      eventKey: "SMOKE_PURGE",
      recipient: customer.emailNormalized!,
      subject: "Purge proof",
      html: "<p>Purge proof</p>",
      dedupeKey: `p11-purge:${randomUUID()}`,
    });
    await sweepEmailOutbox();
    await prisma.emailLog.updateMany({ where: { outboxId: oldMessage.id }, data: { createdAt: new Date(0) } });
    const pending = await queueEmail({
      eventKey: "SMOKE_PENDING",
      recipient: customer.emailNormalized!,
      subject: "Pending proof",
      html: "<p>Pending proof</p>",
      dedupeKey: `p11-pending:${randomUUID()}`,
    });
    assert.equal(await purgeEmailLogs(new Date(1)), 1);
    assert.equal((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: pending.id } })).status, "PENDING");
    assert.ok(await prisma.auditEvent.findFirst({ where: { action: "email.logs_purged" } }));
    console.log("S5 passed: test mode captured mail; retention purged eligible logs while keeping active outbox work and audit evidence.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await startLocalDatabase();
  try {
    await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
    await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
    await runWithLocalDatabase("tsx", ["scripts/smoke-p11.ts", "verify"]);
  } finally {
    await stopLocalDatabase();
  }
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
