import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PrismaClient,
  NotifyChannel,
  NotifyStatus,
  AuditAction,
} from "@prisma/client";
import { enqueueOrderEmail } from "../src/lib/email/order-emails";
import { sweepOutbox } from "../src/lib/notify/outbox";
import { purgeEmailLogs, sendTestEmail } from "../src/lib/email/purge";
import { setSetting } from "../src/lib/settings";
import { EMAIL_SETTINGS } from "../src/lib/resend/client";
import { smsSend } from "../src/lib/notify/sms";

const base = process.env.APP_URL || "http://127.0.0.1:3103";
const cronSecret = process.env.CRON_SECRET || "tomchei-arm03-cron-dev-only";
const hmacSecret = process.env.NEWSLETTER_HMAC_SECRET;
const evidence = [];
const db = new PrismaClient();

function cookieHeader(userId = "dev_manager_1") {
  return { cookie: `dev_user_id=${userId}` };
}

function signToken(subscriberId, tokenVersion, exp) {
  const payload = `${subscriberId}.${tokenVersion}.${exp}`;
  const sig = createHmac("sha256", hmacSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

async function req(pathname, init = {}) {
  const headers = {
    Origin: base,
    ...(init.headers || {}),
  };
  const res = await fetch(`${base}${pathname}`, { ...init, headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function push(id, check, pass, extra = {}) {
  evidence.push({ id, check, pass, ...extra });
}

async function cron(pathname, token) {
  const url = token ? `${pathname}?token=${encodeURIComponent(token)}` : pathname;
  return req(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
}

async function main() {
  if (!hmacSecret) throw new Error("NEWSLETTER_HMAC_SECRET required");
  await db.$connect();

  // --- S1: Preferences + tokens ---
  const email = `p11-s1-${Date.now()}@tomchei.local`;
  const sub = await req("/api/newsletter/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      preferences: { seasons: true, updates: true, promotions: true },
    }),
  });
  const row = await db.newsletterSubscriber.findFirst({
    where: { email },
  });
  if (!row) throw new Error("subscribe did not persist");

  const token = signToken(row.id, row.tokenVersion, Date.now() + 60_000 * 60);
  const prefsAllOff = await req("/api/newsletter/preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      preferences: { seasons: false, updates: false, promotions: false },
    }),
  });
  const afterPrefs = await db.newsletterSubscriber.findUnique({ where: { id: row.id } });
  const prefs = afterPrefs?.preferences;
  const prefsOk =
    prefsAllOff.status === 200 &&
    prefs &&
    typeof prefs === "object" &&
    prefs.seasons === false &&
    prefs.updates === false &&
    prefs.promotions === false;

  const prefsAllOn = await req("/api/newsletter/preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      preferences: { seasons: true, updates: true, promotions: true },
    }),
  });
  const afterOn = await db.newsletterSubscriber.findUnique({ where: { id: row.id } });
  const threeStatesOk =
    prefsOk &&
    prefsAllOn.status === 200 &&
    afterOn?.preferences?.seasons === true &&
    afterOn?.preferences?.updates === true &&
    afterOn?.preferences?.promotions === true;

  const tampered = await req("/api/newsletter/preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: token.slice(0, -4) + "xxxx",
      preferences: { seasons: false, updates: false, promotions: false },
    }),
  });
  const expired = await req("/api/newsletter/preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: signToken(row.id, row.tokenVersion, Date.now() - 1000),
      preferences: { seasons: false, updates: false, promotions: false },
    }),
  });
  const unsub = await req("/api/newsletter/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const afterUnsub = await db.newsletterSubscriber.findUnique({ where: { id: row.id } });

  const s1Ok =
    sub.status === 200 &&
    threeStatesOk &&
    tampered.status >= 400 &&
    expired.status >= 400 &&
    unsub.status === 200 &&
    Boolean(afterUnsub?.unsubscribedAt) &&
    !sub.json?.unsubscribeToken;
  push("S1", "Preferences + tokens", Boolean(s1Ok), {
    subscribed: sub.status === 200,
    threeStates: threeStatesOk,
    tamperedRejected: tampered.status >= 400,
    expiredRejected: expired.status >= 400,
    unsubscribed: unsub.status === 200 && Boolean(afterUnsub?.unsubscribedAt),
    noTokenLeak: !sub.json?.unsubscribeToken,
  });

  // --- S2: Campaign flow + idempotent rerun ---
  const subA = await req("/api/newsletter/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `p11-camp-a-${Date.now()}@tomchei.local` }),
  });
  const subB = await req("/api/newsletter/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `p11-camp-b-${Date.now()}@tomchei.local` }),
  });
  const campCreate = await req("/api/admin/email", {
    method: "POST",
    headers: { ...cookieHeader(), "content-type": "application/json" },
    body: JSON.stringify({
      action: "create_campaign",
      name: `P11 Camp ${Date.now()}`,
      subject: "P11 smoke campaign",
      htmlBody: "<p>Hello campaign</p>",
    }),
  });
  const campaignId = campCreate.json?.campaign?.id;
  const preview = await req("/api/admin/email", {
    method: "POST",
    headers: { ...cookieHeader(), "content-type": "application/json" },
    body: JSON.stringify({ action: "preview_campaign", campaignId }),
  });
  const testSend = await req("/api/admin/email", {
    method: "POST",
    headers: { ...cookieHeader(), "content-type": "application/json" },
    body: JSON.stringify({
      action: "test_send_campaign",
      campaignId,
      to: "manager@tomchei.local",
    }),
  });
  const send1 = await req("/api/admin/email", {
    method: "POST",
    headers: { ...cookieHeader(), "content-type": "application/json" },
    body: JSON.stringify({ action: "send_campaign", campaignId }),
  });
  const send2 = await req("/api/admin/email", {
    method: "POST",
    headers: { ...cookieHeader(), "content-type": "application/json" },
    body: JSON.stringify({ action: "send_campaign", campaignId }),
  });
  const list = await req("/api/admin/email?tab=campaigns", {
    headers: cookieHeader(),
  });
  const deliveries = await db.emailCampaignDelivery.count({ where: { campaignId } });
  const s2Ok =
    campCreate.status === 200 &&
    preview.status === 200 &&
    testSend.status === 200 &&
    send1.status === 200 &&
    send2.status === 200 &&
    (send2.json?.skipped ?? 0) >= (send1.json?.created ?? 0) &&
    (send2.json?.created ?? 1) === 0 &&
    list.status === 200 &&
    deliveries === (send1.json?.created ?? deliveries) &&
    subA.status === 200 &&
    subB.status === 200;

  push("S2", "Campaign flow + idempotent rerun", Boolean(s2Ok), {
    campaignId,
    created: send1.json?.created,
    skippedRerun: send2.json?.skipped,
    rerunCreated: send2.json?.created,
    deliveries,
  });

  // --- S3: Transactional + failure → retry → single delivery ---
  await setSetting(EMAIL_SETTINGS.forceFail, { enabled: true });
  // Park unrelated pending so fail/retry targets only these three
  await db.notificationOutbox.updateMany({
    where: { status: { in: [NotifyStatus.PENDING, NotifyStatus.FAILED, NotifyStatus.CLAIMED] } },
    data: { status: NotifyStatus.CAPTURED, nextAttemptAt: null, claimedAt: null, claimedBy: null },
  });
  const orderId = `p11-order-${Date.now()}`;
  const recipient = `p11-tx-${Date.now()}@tomchei.local`;
  const keys = ["order.confirmation", "order.payment_link", "order.refund"];
  const enqueued = [];
  for (const key of keys) {
    const result = await enqueueOrderEmail({
      key,
      orderId,
      recipientEmail: recipient,
      vars: {
        orderNumber: "9001",
        customerName: "Smoke",
        total: "$10.00",
        paymentUrl: `${base}/checkout`,
        refundAmount: "$5.00",
      },
    });
    enqueued.push(result);
  }
  const failSweep = await sweepOutbox({ workerId: "smoke-p11-fail", limit: 20 });
  const failedRows = await db.notificationOutbox.findMany({
    where: {
      recipientKey: recipient,
      status: NotifyStatus.FAILED,
    },
  });
  const failAudits = await db.auditLog.count({
    where: { action: AuditAction.NOTIFICATION_FAILED },
  });

  await setSetting(EMAIL_SETTINGS.forceFail, { enabled: false });
  await db.notificationOutbox.updateMany({
    where: { recipientKey: recipient, status: NotifyStatus.FAILED },
    data: { nextAttemptAt: new Date(), claimedAt: null, claimedBy: null },
  });
  const okSweep = await sweepOutbox({ workerId: "smoke-p11-ok", limit: 20 });
  const sentRows = await db.notificationOutbox.findMany({
    where: { recipientKey: recipient },
  });
  const uniqueKeys = new Set(sentRows.map((r) => r.idempotencyKey));
  const allDelivered = sentRows.every(
    (r) => r.status === NotifyStatus.SENT || r.status === NotifyStatus.CAPTURED,
  );
  const rerunSame = await enqueueOrderEmail({
    key: "order.confirmation",
    orderId,
    recipientEmail: recipient,
    vars: {
      orderNumber: "9001",
      customerName: "Smoke",
      total: "$10.00",
    },
  });
  const s3Ok =
    enqueued.every((e) => e.ok && e.value.created) &&
    failSweep.failed >= 3 &&
    failedRows.length === 3 &&
    failAudits >= 1 &&
    okSweep.captured + okSweep.sent >= 3 &&
    allDelivered &&
    uniqueKeys.size === keys.length &&
    rerunSame.ok &&
    rerunSame.value.created === false;

  push("S3", "Transactional + failure trail", Boolean(s3Ok), {
    enqueued: enqueued.map((e) => (e.ok ? e.value.status : e.error)),
    failSweep,
    okSweep,
    outboxCount: sentRows.length,
    uniqueKeys: uniqueKeys.size,
    rerunCreated: rerunSame.ok ? rerunSame.value.created : null,
    failedBefore: failedRows.length,
  });

  // --- S4: Cron auth + overlap ---
  const cronPaths = [
    "/api/cron/outbox-sweep",
    "/api/cron/purge-email-log",
    "/api/cron/pickup-expiry",
    "/api/cron/payment-reminder",
    "/api/cron/season-auto-flip",
  ];
  const missing = [];
  const wrong = [];
  const correct = [];
  for (const p of cronPaths) {
    const noAuth = await req(p, { method: "POST" });
    const badAuth = await req(p, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const good = await cron(p);
    missing.push(noAuth.status);
    wrong.push(badAuth.status);
    correct.push(good.status);
  }
  const overlapToken = `p11-overlap-${Date.now()}`;
  const o1 = await cron("/api/cron/outbox-sweep", overlapToken);
  const o2 = await cron("/api/cron/outbox-sweep", overlapToken);
  // Park other pending so the claim race has exactly one target
  await db.notificationOutbox.updateMany({
    where: { status: { in: [NotifyStatus.PENDING, NotifyStatus.FAILED, NotifyStatus.CLAIMED] } },
    data: { status: NotifyStatus.CAPTURED, nextAttemptAt: null, claimedAt: null, claimedBy: null },
  });
  const raceRow = await db.notificationOutbox.create({
    data: {
      channel: NotifyChannel.EMAIL,
      templateKey: "smoke.overlap",
      recipientKey: "overlap@tomchei.local",
      idempotencyKey: `smoke-overlap-${Date.now()}`,
      body: "overlap",
      status: NotifyStatus.PENDING,
      nextAttemptAt: new Date(),
    },
  });
  const [raceA, raceB] = await Promise.all([
    sweepOutbox({ workerId: "race-a", limit: 5 }),
    sweepOutbox({ workerId: "race-b", limit: 5 }),
  ]);
  const claimedTotal = raceA.claimed + raceB.claimed;
  const raceFinal = await db.notificationOutbox.findUnique({ where: { id: raceRow.id } });
  const s4Ok =
    missing.every((s) => s === 401 || s === 403) &&
    wrong.every((s) => s === 401 || s === 403) &&
    correct.every((s) => s === 200) &&
    o1.status === 200 &&
    o2.status === 200 &&
    (o2.json?.skipped === true || o1.json?.skipped === true || o2.json?.reason === "overlap") &&
    claimedTotal === 1 &&
    (raceFinal?.status === NotifyStatus.SENT ||
      raceFinal?.status === NotifyStatus.CAPTURED);

  push("S4", "Cron auth + overlap", Boolean(s4Ok), {
    missing,
    wrong,
    correct,
    overlap: { o1: o1.json, o2: o2.json },
    raceClaimed: claimedTotal,
    raceFinal: raceFinal?.status,
  });

  // --- S5: Purge + test mode ---
  const activeOutbox = await db.notificationOutbox.create({
    data: {
      channel: NotifyChannel.EMAIL,
      templateKey: "smoke.active",
      recipientKey: "active@tomchei.local",
      idempotencyKey: `smoke-active-${Date.now()}`,
      body: "keep me",
      status: NotifyStatus.PENDING,
      nextAttemptAt: new Date(Date.now() + 60_000),
    },
  });
  const keepLog = await db.emailLog.create({
    data: {
      channel: NotifyChannel.EMAIL,
      templateKey: "smoke.active",
      recipientKey: "active@tomchei.local",
      body: "linked to active outbox",
      status: "queued",
      outboxId: activeOutbox.id,
      purgeAfter: new Date(Date.now() - 1000),
    },
  });
  const purgeLog = await db.emailLog.create({
    data: {
      channel: NotifyChannel.EMAIL,
      templateKey: "smoke.old",
      recipientKey: "old@tomchei.local",
      body: "purge me",
      status: "sent",
      purgeAfter: new Date(Date.now() - 1000),
    },
  });
  const auditBefore = await db.auditLog.count();
  const purgeResult = await purgeEmailLogs();
  const keepStill = await db.emailLog.findUnique({ where: { id: keepLog.id } });
  const purgedGone = await db.emailLog.findUnique({ where: { id: purgeLog.id } });
  const outboxStill = await db.notificationOutbox.findUnique({
    where: { id: activeOutbox.id },
  });
  const auditAfter = await db.auditLog.count();
  const testSendResult = await sendTestEmail({
    to: "manager@tomchei.local",
    subject: "P11 settings test",
  });
  const sms = await smsSend({ to: "+15555550100", body: "P11 SMS dispatch check" });
  const s5Ok =
    purgeResult.deleted >= 1 &&
    !purgedGone &&
    Boolean(keepStill) &&
    Boolean(outboxStill) &&
    auditAfter >= auditBefore &&
    testSendResult.ok &&
    testSendResult.value.captured === true &&
    sms.ok &&
    Boolean(sms.captured);

  push("S5", "Purge + test mode + SMS", Boolean(s5Ok), {
    purgeResult,
    keepLog: Boolean(keepStill),
    purgedGone: !purgedGone,
    outboxKept: Boolean(outboxStill),
    testCaptured: testSendResult.ok ? testSendResult.value.captured : null,
    smsCaptured: sms.captured,
  });

  const hubPage = await req("/admin/email", { headers: cookieHeader() });
  const prefsPage = await req("/newsletter/preferences");

  const passed = evidence.filter((e) => e.pass).length;
  const failed = evidence.length - passed;

  const md = [
    "# PHASE-P11-SMOKE",
    "",
    "**Arm:** arm-03",
    `**Base:** ${base}`,
    `**Passed:** ${passed} / ${evidence.length}`,
    `**Failed:** ${failed}`,
    "",
    "| ID | Check | Pass |",
    "|---|---|---|",
    ...evidence.map((e) => `| ${e.id} | ${e.check} | ${e.pass ? "PASS" : "FAIL"} |`),
    "",
    "## Details",
    "",
    "```json",
    JSON.stringify(evidence, null, 2),
    "```",
    "",
    `Pages: email-hub=${hubPage.status} preferences=${prefsPage.status}`,
    "",
  ].join("\n");

  const status = [
    "# PHASE-P11-STATUS — arm-03",
    "",
    "**Phase:** P11 — Email & notification platform",
    `**Result:** ${failed === 0 ? "PASS" : "FAIL"}`,
    `**Smoke:** ${passed}/${evidence.length} (\`arms/arm-03/workspace/.scratch/PHASE-P11-SMOKE.md\`)`,
    "**Ports:** web 3103 / db 4103",
    "",
    "## Delivered",
    "",
    "1. Resend SDK module + email hub (campaigns/subscribers/lists/templates/triggered)",
    "2. Campaign send with idempotent reruns",
    "3. Transactional confirmation/payment/refund emails + outbox retry sweeper",
    "4. Email-log purge cron, settings test sender, SMS dispatch for P9 reuse",
    "5. Cron routes middleware-public + bearer auth",
    "",
    "## Blockers",
    "",
    failed === 0 ? "none" : JSON.stringify(evidence.filter((e) => !e.pass), null, 2),
    "",
  ].join("\n");

  const scratchDir = path.join(process.cwd(), ".scratch");
  const resultsDir = path.join(process.cwd(), "..", "results");
  await mkdir(scratchDir, { recursive: true });
  await mkdir(resultsDir, { recursive: true });
  await writeFile(path.join(scratchDir, "PHASE-P11-SMOKE.md"), md, "utf8");
  await writeFile(path.join(scratchDir, "PHASE-P11-STATUS.md"), status, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P11-SMOKE.md"), md, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P11-STATUS.md"), status, "utf8");
  const json = JSON.stringify(
    { phase: "P11", ok: failed === 0, passed, failed, total: evidence.length, evidence },
    null,
    2,
  );
  await writeFile(path.join(scratchDir, "PHASE-P11-SMOKE.json"), json, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P11-SMOKE.json"), json, "utf8");

  console.log(JSON.stringify({ ok: failed === 0, passed, failed, evidence }, null, 2));
  if (failed > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
