import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { MessageChannel, PrismaClient } from "@prisma/client";
import {
  enqueueMessage,
  enqueueTransactionalEmail,
  ensureMessagingConfiguration,
  purgeMessageLogs,
  sweepMessageOutbox,
} from "../src/domain/messaging";
import {
  createNewsletterToken,
  verifyNewsletterToken,
} from "../src/lib/newsletter";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, separator)] ??= line.slice(separator + 1);
  }
}

const prisma = new PrismaClient();
const runKey = randomUUID().slice(0, 8);
const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3101";
const cronSecret = process.env.CRON_SECRET ?? "cron-smoke-shared";
const authSecret =
  process.env.TEST_AUTH_SECRET ?? "p5-local-smoke-signing-key-2026";
process.env.EMAIL_TEST_MODE = "true";
process.env.CRON_SECRET = cronSecret;

function managerHeaders() {
  const timestamp = Date.now();
  const signature = createHmac("sha256", authSecret)
    .update(`__local_manager__.${timestamp}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-test-clerk-user-id": "__local_manager__",
    "x-test-auth-token": `${timestamp}.${signature}`,
  };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function run() {
  await ensureMessagingConfiguration(prisma);

  const email = `p11-${runKey}@example.test`;
  const subscribeResponse = await fetch(`${baseUrl}/api/newsletter/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(subscribeResponse.status, 200);
  const subscribePayload = await json(subscribeResponse);
  const token = String(subscribePayload.preferenceToken);
  assert.ok(token.length > 20);
  const preferenceResponse = await fetch(
    `${baseUrl}/api/newsletter/preferences?token=${encodeURIComponent(token)}`,
  );
  assert.equal(preferenceResponse.status, 200);
  const changedPreferences = {
    token,
    productUpdates: false,
    volunteerStories: true,
    communityImpact: false,
    isSubscribed: true,
  };
  assert.equal(
    (
      await fetch(`${baseUrl}/api/newsletter/preferences`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changedPreferences),
      })
    ).status,
    200,
  );
  const subscriber = await prisma.newsletterSubscriber.findUniqueOrThrow({
    where: { email },
  });
  assert.deepEqual(
    [
      subscriber.productUpdates,
      subscriber.volunteerStories,
      subscriber.communityImpact,
    ],
    [false, true, false],
  );
  assert.equal(
    (
      await fetch(
        `${baseUrl}/api/newsletter/preferences?token=${encodeURIComponent(`${token}x`)}`,
      )
    ).status,
    401,
  );
  const expiredToken = createNewsletterToken(subscriber.id, 0);
  assert.equal(verifyNewsletterToken(expiredToken, Date.now()), null);
  assert.equal(
    (
      await fetch(`${baseUrl}/api/newsletter/preferences`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...changedPreferences, isSubscribed: false }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await prisma.newsletterSubscriber.findUniqueOrThrow({
        where: { email },
      })
    ).isSubscribed,
    false,
  );
  await prisma.newsletterSubscriber.update({
    where: { email },
    data: {
      isSubscribed: true,
      productUpdates: true,
      volunteerStories: true,
      communityImpact: true,
      unsubscribedAt: null,
    },
  });
  console.log(
    "S1 PASS signed preference token changed all states, rejected tampered/expired tokens, and unsubscribed",
  );

  const list = await prisma.emailList.findUniqueOrThrow({
    where: { key: "product-updates" },
  });
  const campaignResponse = await fetch(`${baseUrl}/api/admin/email`, {
    method: "POST",
    headers: managerHeaders(),
    body: JSON.stringify({
      action: "createCampaign",
      name: `P11 campaign ${runKey}`,
      subject: "P11 campaign preview",
      htmlBody: "<p>Campaign body</p>",
      textBody: "Campaign body",
      emailListId: list.id,
    }),
  });
  assert.equal(campaignResponse.status, 201);
  const campaign = await json(campaignResponse);
  assert.equal(campaign.subject, "P11 campaign preview");
  const campaignId = String(campaign.id);
  assert.equal(
    (
      await fetch(`${baseUrl}/api/admin/email`, {
        method: "POST",
        headers: managerHeaders(),
        body: JSON.stringify({
          action: "testCampaign",
          campaignId,
          recipient: `staff-${runKey}@example.test`,
        }),
      })
    ).status,
    200,
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const sendResponse = await fetch(`${baseUrl}/api/admin/email`, {
      method: "POST",
      headers: managerHeaders(),
      body: JSON.stringify({ action: "sendCampaign", campaignId }),
    });
    assert.equal(sendResponse.status, 200);
  }
  assert.equal(
    await prisma.messageOutbox.count({
      where: {
        idempotencyKey: `campaign:${campaignId}:${subscriber.id}`,
      },
    }),
    1,
  );
  const hubResponse = await fetch(`${baseUrl}/api/admin/email`, {
    headers: managerHeaders(),
  });
  assert.equal(hubResponse.status, 200);
  assert.ok(
    ((await json(hubResponse)).campaigns as Array<{ id: string }>).some(
      (entry) => entry.id === campaignId,
    ),
  );
  console.log(
    "S2 PASS campaign draft/preview/test/send/list completed and rerun produced no duplicate recipient",
  );

  for (const templateKey of [
    "order.confirmation",
    "order.payment_link",
    "order.refund",
  ]) {
    await enqueueTransactionalEmail(prisma, {
      idempotencyKey: `p11-domain:${runKey}:${templateKey}`,
      templateKey,
      recipient: email,
      variables: {
        customerName: "P11 Customer",
        orderNumber: "P11-1001",
        paymentUrl: `${baseUrl}/pay`,
        refundAmount: "$12.00",
      },
    });
  }
  process.env.EMAIL_TEST_MODE = "false";
  process.env.RESEND_API_KEY = "re_test_smoke";
  process.env.EMAIL_FROM_ADDRESS = "smoke@example.test";
  process.env.RESEND_FORCE_FAILURE = "true";
  const failureKey = `p11-provider-failure:${runKey}`;
  await enqueueMessage(prisma, {
    idempotencyKey: failureKey,
    channel: MessageChannel.EMAIL,
    eventKey: failureKey,
    recipient: email,
    subject: "Forced failure",
    htmlBody: "<p>Forced failure</p>",
    textBody: "Forced failure",
    payload: { smoke: true },
  });
  const failedSweep = await sweepMessageOutbox(prisma, {
    workerId: `failure-${runKey}`,
    limit: 100,
  });
  assert.ok(failedSweep.failed >= 1);
  const failedMessage = await prisma.messageOutbox.findUniqueOrThrow({
    where: { idempotencyKey: failureKey },
  });
  assert.equal(failedMessage.attempts, 1);
  assert.match(failedMessage.lastError ?? "", /forced failure/i);
  process.env.RESEND_FORCE_FAILURE = "false";
  process.env.EMAIL_TEST_MODE = "true";
  await prisma.messageOutbox.update({
    where: { id: failedMessage.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await sweepMessageOutbox(prisma, {
    workerId: `retry-${runKey}`,
    limit: 100,
  });
  const recoveredMessage = await prisma.messageOutbox.findUniqueOrThrow({
    where: { id: failedMessage.id },
    include: { attemptLog: true },
  });
  assert.equal(recoveredMessage.status, "CAPTURED");
  assert.equal(recoveredMessage.attemptLog.length, 2);
  console.log(
    "S3 PASS confirmation/payment/refund templates queued; forced provider failure retried to one captured delivery with audit trail",
  );

  for (let index = 0; index < 6; index++) {
    await enqueueMessage(prisma, {
      idempotencyKey: `p11-overlap:${runKey}:${index}`,
      channel: MessageChannel.EMAIL,
      eventKey: `p11-overlap:${runKey}:${index}`,
      recipient: `${index}-${email}`,
      subject: "Overlap",
      htmlBody: "<p>Overlap</p>",
      textBody: "Overlap",
      payload: { index },
    });
  }
  const overlap = await Promise.all([
    sweepMessageOutbox(prisma, { workerId: `overlap-a-${runKey}`, limit: 3 }),
    sweepMessageOutbox(prisma, { workerId: `overlap-b-${runKey}`, limit: 3 }),
  ]);
  assert.equal(
    overlap.reduce((sum, outcome) => sum + outcome.claimed, 0),
    6,
  );
  assert.equal(
    await prisma.messageAttempt.count({
      where: { outbox: { idempotencyKey: { startsWith: `p11-overlap:${runKey}` } } },
    }),
    6,
  );
  for (const route of ["message-outbox", "message-log-purge"]) {
    assert.equal(
      (await fetch(`${baseUrl}/api/cron/${route}`)).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/cron/${route}`, {
          headers: { authorization: "Bearer wrong-secret" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/cron/${route}`, {
          headers: {
            authorization: `Bearer ${cronSecret}`,
            "x-cron-run-key": `${route}:${runKey}`,
          },
        })
      ).status,
      200,
    );
  }
  console.log(
    "S4 PASS both P11 crons rejected missing/wrong secrets, accepted correct secret, and overlapping workers claimed once",
  );

  const captured = await prisma.messageOutbox.findFirstOrThrow({
    where: { status: "CAPTURED" },
    include: { attemptLog: true },
  });
  await prisma.messageAttempt.updateMany({
    where: { outboxId: captured.id },
    data: { attemptedAt: new Date(0) },
  });
  const active = await prisma.messageOutbox.create({
    data: {
      idempotencyKey: `p11-active:${runKey}`,
      channel: "EMAIL",
      eventKey: `p11-active:${runKey}`,
      recipient: email,
      subject: "Active",
      htmlBody: "<p>Active</p>",
      textBody: "Active",
      payload: { active: true },
      status: "PROCESSING",
      lockedAt: new Date(),
      lockedBy: "active-worker",
    },
  });
  const audit = await prisma.auditLog.create({
    data: {
      action: "p11.smoke_audit",
      targetType: "MessageOutbox",
      targetId: captured.id,
    },
  });
  await purgeMessageLogs(
    prisma,
    new Date(Date.now() - 24 * 60 * 60 * 1_000),
    `p11-direct-purge:${runKey}`,
  );
  assert.equal(
    await prisma.messageAttempt.count({ where: { outboxId: captured.id } }),
    0,
  );
  assert.ok(await prisma.messageOutbox.findUnique({ where: { id: captured.id } }));
  assert.ok(await prisma.messageOutbox.findUnique({ where: { id: active.id } }));
  assert.ok(await prisma.auditLog.findUnique({ where: { id: audit.id } }));
  assert.equal(captured.providerMessageId, null);
  console.log(
    "S5 PASS purge removed eligible logs but retained outbox/audit/active work; test mode captured without provider contact",
  );
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
