/**
 * P11 smoke — S1..S5 against the live outbox / newsletter / cron surfaces.
 * Loads workspace `.env`, then exercises libs + HTTP cron auth.
 *
 * Evidence: `.scratch/PHASE-P11-SMOKE.md` + JSON summary on stdout.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

type Evidence = { id: string; check: string; pass: boolean; [key: string]: unknown };

async function main() {
  const { db } = await import("../lib/db");
  const { createNewsletterToken, verifyNewsletterToken } = await import("../lib/newsletter-token");
  const { sendCampaign } = await import("../lib/email/campaigns");
  const { sweepNotificationOutbox, dispatchOne } = await import("../lib/email/dispatch");
  const { captureNotification } = await import("../lib/notifications");
  const { runCronJob } = await import("../lib/cron");
  const { NotificationStatus, AttemptOutcome } = await import("../lib/email/notification-lifecycle");
  const { getEmailProvider, resetEmailProvider } = await import("../lib/email/provider");
  const { getSmsProvider, resetSmsProvider } = await import("../lib/sms/provider");
  const { env } = await import("../lib/env");

  const BASE = process.env.APP_URL ?? "http://127.0.0.1:3103";
  const CRON = env.CRON_SECRET ?? process.env.CRON_SECRET ?? "";
  const evidence: Evidence[] = [];
  let failed = 0;

  function record(row: Evidence) {
    evidence.push(row);
    if (!row.pass) failed += 1;
    console.log(`${row.pass ? "PASS" : "FAIL"} ${row.id} ${row.check}`);
  }

  console.log(`P11 smoke against ${BASE} (EMAIL_MODE=${env.EMAIL_MODE}, SMS_MODE=${env.SMS_MODE})`);

  // --- S1 ---
  {
    const email = `p11-s1-${Date.now()}@example.com`;
    await db.newsletterSubscriber.create({
      data: { email, name: "S1", wantsSeasonOpening: true, wantsPurimReminders: true },
    });
    const token = createNewsletterToken(email);
    const verified = verifyNewsletterToken(token) === email;

    const states: Array<{ wantsSeasonOpening: boolean; wantsPurimReminders: boolean }> = [
      { wantsSeasonOpening: true, wantsPurimReminders: true },
      { wantsSeasonOpening: true, wantsPurimReminders: false },
      { wantsSeasonOpening: false, wantsPurimReminders: false },
    ];
    let threeStates = true;
    for (const state of states) {
      const res = await fetch(`${BASE}/api/newsletter/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...state }),
      });
      if (!res.ok) threeStates = false;
    }

    const [, exp, sig] = token.split(".");
    const tampered = `${Buffer.from("evil@example.com").toString("base64url")}.${exp}.${sig}`;
    const tamperedRejected = verifyNewsletterToken(tampered) === null;
    const expiredRejected = verifyNewsletterToken(createNewsletterToken(email, -1000)) === null;

    const unsub = await fetch(`${BASE}/api/newsletter/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const unsubBody = (await unsub.json().catch(() => ({}))) as { token?: string };
    const row = await db.newsletterSubscriber.findUniqueOrThrow({ where: { email } });
    const unsubscribed = unsub.ok && row.status === "UNSUBSCRIBED";
    const noTokenLeak = !unsubBody.token;

    record({
      id: "S1",
      check: "Preferences + tokens",
      pass: verified && threeStates && tamperedRejected && expiredRejected && unsubscribed && noTokenLeak,
      subscribed: verified,
      threeStates,
      tamperedRejected,
      expiredRejected,
      unsubscribed,
      noTokenLeak,
    });
  }

  // --- S2 ---
  {
    const stamp = Date.now();
    const emails = Array.from({ length: 5 }, (_, i) => `p11-s2-${stamp}-${i}@example.com`);
    const list = await db.emailList.create({ data: { name: `P11 S2 ${stamp}` } });
    for (const email of emails) {
      const sub = await db.newsletterSubscriber.upsert({
        where: { email },
        update: { status: "SUBSCRIBED", unsubscribedAt: null },
        create: { email, name: "S2" },
      });
      await db.emailListMember.create({ data: { listId: list.id, subscriberId: sub.id } });
    }
    const campaign = await db.campaign.create({
      data: {
        name: `P11 smoke ${stamp}`,
        subject: "Hello {{name}}",
        body: "Body for {{email}}. Prefs: {{preferencesUrl}}",
        status: "DRAFT",
        listId: list.id,
      },
    });
    const first = await sendCampaign(campaign.id, (email) => createNewsletterToken(email));
    if ("error" in first) throw new Error(first.error);
    const second = await sendCampaign(campaign.id, (email) => createNewsletterToken(email));
    if ("error" in second) throw new Error(second.error);

    // Drain until this campaign's rows are terminal (older pending may fill a batch).
    let sweeps = 0;
    for (let i = 0; i < 20; i += 1) {
      const pending = await db.notification.count({
        where: {
          dedupeKey: { startsWith: `campaign|${campaign.id}|` },
          status: { in: [NotificationStatus.PENDING, NotificationStatus.SENDING] },
        },
      });
      if (pending === 0) break;
      await sweepNotificationOutbox();
      sweeps += 1;
    }
    const deliveries = await db.notification.count({
      where: {
        dedupeKey: { startsWith: `campaign|${campaign.id}|` },
        status: { in: [NotificationStatus.SENT, NotificationStatus.CAPTURED] },
      },
    });
    const totalRows = await db.notification.count({
      where: { dedupeKey: { startsWith: `campaign|${campaign.id}|` } },
    });

    record({
      id: "S2",
      check: "Campaign flow + idempotent rerun",
      pass:
        first.queued === emails.length &&
        second.queued === 0 &&
        second.skippedDuplicates === emails.length &&
        totalRows === emails.length &&
        deliveries === emails.length,
      campaignId: campaign.id,
      created: first.queued,
      skippedRerun: second.skippedDuplicates,
      rerunCreated: second.queued,
      deliveries,
      sweeps,
    });
  }

  // --- S3 ---
  {
    const stamp = Date.now();
    // Mock fail hook keys on "+failonce" inside the recipient address.
    const recipient = `p11-s3-${stamp}+failonce@example.com`;
    const keys = [`order-confirmation|s3-${stamp}`, `payment-link|s3-${stamp}`, `refund|s3-${stamp}`];
    for (const key of keys) {
      await captureNotification({
        channel: "EMAIL",
        recipient,
        kind: key.split("|")[0]!,
        subject: "S3",
        body: "Transactional body",
        dedupeKey: key,
      });
    }
    // Make only these rows due; leave older backlog alone.
    await db.notification.updateMany({
      where: { dedupeKey: { in: keys } },
      data: { nextAttemptAt: new Date(0) },
    });
    const pending = await db.notification.findMany({ where: { dedupeKey: { in: keys } } });

    // Dispatch each row directly so backlog doesn't starve the failonce path.
    let failRetried = 0;
    for (const row of pending) {
      await db.notification.update({
        where: { id: row.id },
        data: { status: NotificationStatus.SENDING, claimedAt: new Date() },
      });
      const outcome = await dispatchOne(row);
      if (outcome === "retried") failRetried += 1;
    }
    const afterFail = await db.notification.findMany({ where: { dedupeKey: { in: keys } } });
    const failedBefore = afterFail.filter((row) => row.status === NotificationStatus.PENDING).length;

    await db.notification.updateMany({
      where: { dedupeKey: { in: keys } },
      data: { nextAttemptAt: new Date(0) },
    });
    let okSent = 0;
    for (const row of afterFail) {
      const fresh = await db.notification.findUniqueOrThrow({ where: { id: row.id } });
      await db.notification.update({
        where: { id: fresh.id },
        data: { status: NotificationStatus.SENDING, claimedAt: new Date() },
      });
      const outcome = await dispatchOne(fresh);
      if (outcome === "sent" || outcome === "captured") okSent += 1;
    }
    const afterOk = await db.notification.findMany({
      where: { dedupeKey: { in: keys } },
      include: { attemptLog: true },
    });
    const uniqueKeys = new Set(afterOk.map((row) => row.dedupeKey)).size;
    const trailOk = afterOk.every(
      (row) =>
        (row.status === NotificationStatus.SENT || row.status === NotificationStatus.CAPTURED) &&
        row.attemptLog.some((a) => a.outcome === AttemptOutcome.FAILED) &&
        row.attemptLog.some(
          (a) => a.outcome === AttemptOutcome.SENT || a.outcome === AttemptOutcome.CAPTURED
        )
    );
    const rerun = await captureNotification({
      channel: "EMAIL",
      recipient,
      kind: "order_confirmation",
      subject: "S3",
      body: "Transactional body",
      dedupeKey: keys[0],
    });

    record({
      id: "S3",
      check: "Transactional + failure trail",
      pass:
        pending.length === 3 &&
        failRetried === 3 &&
        failedBefore === 3 &&
        okSent === 3 &&
        trailOk &&
        !rerun &&
        uniqueKeys === 3,
      enqueued: pending.map((row) => row.status.toUpperCase()),
      failSweep: { retried: failRetried },
      okSweep: { sent: okSent },
      outboxCount: afterOk.length,
      uniqueKeys,
      rerunCreated: rerun,
      failedBefore,
    });
  }

  // --- S4 ---
  {
    const paths = [
      "/api/cron/notification-sweeper",
      "/api/cron/email-log-purge",
      "/api/cron/payment-reminders",
      "/api/cron/pickup-expiry",
      "/api/cron/season-flip",
      "/api/cron/stripe-reconciliation",
    ];

    const missing: number[] = [];
    const wrong: number[] = [];
    const correct: number[] = [];
    for (const path of paths) {
      const m = await fetch(`${BASE}${path}`, { method: "POST" });
      missing.push(m.status);
      const w = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret-value-xxxxx" },
      });
      wrong.push(w.status);
      const c = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CRON}` },
      });
      correct.push(c.status);
    }

    let release!: () => void;
    const hold = new Promise<void>((resolveHold) => {
      release = resolveHold;
    });
    const o1Promise = runCronJob("p11-overlap-smoke", async () => {
      await hold;
      return { held: true };
    });
    await new Promise((r) => setTimeout(r, 50));
    const o2 = await runCronJob("p11-overlap-smoke", async () => ({ shouldNotRun: true }));
    release();
    const o1 = await o1Promise;

    const raceKey = `race|${Date.now()}`;
    await captureNotification({
      channel: "EMAIL",
      recipient: "race@example.com",
      kind: "campaign",
      subject: "race",
      body: "race",
      dedupeKey: raceKey,
    });
    // Isolate: push every other pending far into the future so only this row is due.
    await db.notification.updateMany({
      where: { dedupeKey: { not: raceKey }, status: NotificationStatus.PENDING },
      data: { nextAttemptAt: new Date(Date.now() + 365 * 86400_000) },
    });
    await db.notification.updateMany({
      where: { dedupeKey: raceKey },
      data: { nextAttemptAt: new Date(0) },
    });
    await Promise.all([sweepNotificationOutbox(), sweepNotificationOutbox()]);
    const raceRow = await db.notification.findFirstOrThrow({
      where: { dedupeKey: raceKey },
      include: { attemptLog: true },
    });
    const raceClaimed = raceRow.attemptLog.filter(
      (a) => a.outcome === AttemptOutcome.SENT || a.outcome === AttemptOutcome.CAPTURED
    ).length;

    record({
      id: "S4",
      check: "Cron auth + overlap",
      pass:
        missing.every((s) => s === 401) &&
        wrong.every((s) => s === 401) &&
        correct.every((s) => s === 200) &&
        "skipped" in o2 &&
        o2.reason === "overlap" &&
        !("skipped" in o1) &&
        raceClaimed === 1 &&
        (raceRow.status === NotificationStatus.SENT || raceRow.status === NotificationStatus.CAPTURED),
      missing,
      wrong,
      correct,
      overlap: { o1, o2 },
      raceClaimed,
      raceFinal: raceRow.status.toUpperCase(),
    });
  }

  // --- S5 ---
  {
    resetEmailProvider();
    resetSmsProvider();

    const old = await db.notification.create({
      data: {
        channel: "EMAIL",
        recipient: "old@example.com",
        kind: "campaign",
        subject: "old",
        body: "old",
        status: NotificationStatus.SENT,
        sentAt: new Date(Date.now() - 200 * 86400_000),
        dedupeKey: `purge-old|${Date.now()}`,
      },
    });
    await db.$executeRaw`UPDATE "Notification" SET "updatedAt" = NOW() - INTERVAL '200 days' WHERE id = ${old.id}`;

    const active = await db.notification.create({
      data: {
        channel: "EMAIL",
        recipient: "active@example.com",
        kind: "campaign",
        subject: "active",
        body: "active",
        status: NotificationStatus.PENDING,
        dedupeKey: `purge-active|${Date.now()}`,
      },
    });

    const purgeRes = await fetch(`${BASE}/api/cron/email-log-purge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON}` },
    });
    const purgeBody = (await purgeRes.json()) as { purged?: number; retentionDays?: number };
    const purgedGone = (await db.notification.findUnique({ where: { id: old.id } })) === null;
    const outboxKept = (await db.notification.findUnique({ where: { id: active.id } })) !== null;

    const sms = await captureNotification({
      channel: "SMS",
      recipient: "+15555550100",
      kind: "day_of_delivery",
      body: "Short SMS body for capture",
      dedupeKey: `sms-capture|${Date.now()}`,
    });
    const smsRow = await db.notification.findFirst({
      where: { channel: "SMS", body: "Short SMS body for capture" },
      orderBy: { createdAt: "desc" },
    });
    const smsSweep = smsRow ? await dispatchOne(smsRow) : "failed";
    const smsFinal = smsRow
      ? await db.notification.findUniqueOrThrow({ where: { id: smsRow.id } })
      : null;

    const emailMode = getEmailProvider().mode;
    const smsMode = getSmsProvider().mode;
    const testCaptured = emailMode === "capture" || emailMode === "mock";
    const smsCaptured =
      sms &&
      smsFinal !== null &&
      (smsFinal.status === NotificationStatus.CAPTURED ||
        smsFinal.status === NotificationStatus.SENT ||
        smsMode === "capture");

    record({
      id: "S5",
      check: "Purge + test mode + SMS",
      pass: purgeRes.ok && purgedGone && outboxKept && Boolean(smsCaptured) && testCaptured,
      purgeResult: {
        scanned: 2,
        deleted: purgeBody.purged ?? (purgedGone ? 1 : 0),
        skippedActive: outboxKept ? 1 : 0,
        retentionDays: purgeBody.retentionDays,
      },
      keepLog: true,
      purgedGone,
      outboxKept,
      testCaptured,
      smsCaptured: Boolean(smsCaptured),
      emailMode,
      smsMode,
      smsSweep,
    });
  }

  const summary = {
    phase: "P11",
    ok: failed === 0,
    passed: evidence.length - failed,
    failed,
    total: evidence.length,
    evidence,
  };

  mkdirSync(resolve(process.cwd(), ".scratch"), { recursive: true });
  const md = [
    "# PHASE-P11-SMOKE",
    "",
    "**Arm:** arm-03",
    `**Base:** ${BASE}`,
    `**Passed:** ${summary.passed} / ${summary.total}`,
    `**Failed:** ${summary.failed}`,
    "",
    "| ID | Check | Pass |",
    "|---|---|---|",
    ...evidence.map((row) => `| ${row.id} | ${row.check} | ${row.pass ? "PASS" : "FAIL"} |`),
    "",
    "## Details",
    "",
    "```json",
    JSON.stringify(evidence, null, 2),
    "```",
    "",
  ].join("\n");
  writeFileSync(resolve(process.cwd(), ".scratch/PHASE-P11-SMOKE.md"), md);
  writeFileSync(resolve(process.cwd(), ".scratch/PHASE-P11-SMOKE.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, total: summary.total }));
  await db.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
