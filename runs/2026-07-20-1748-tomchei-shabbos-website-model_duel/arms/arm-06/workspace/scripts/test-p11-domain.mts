// DB integration for P11 (R-083/R-085..R-089/R-171/R-172/R-178/R-181,
// G-021): the extended outbox lifecycle over the real HTTP path (in-process
// Resend fixture), retry/backoff to exhaustion, SMS capture, triggered-key
// overrides with resolution order, campaign snapshot/send/rerun idempotency,
// the order-confirmation + payment-link + refund hooks, and the retention
// purge. Requires embedded Postgres on 4106 (db:start).
//
// lib/env snapshots process.env at import and dotenv never overrides an
// existing key, so the fixture config lands with plain assignment BEFORE the
// first lib import (same discipline as test-p9-domain).

import http from "node:http";
import { PrismaClient } from "@prisma/client";

process.env.RESEND_API_KEY = "p11-domain-key";
process.env.AUTH_SECRET ??= "0123456789abcdef0123456789abcdef";

const prisma = new PrismaClient();
let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

interface FixtureSend {
  to: string[];
  subject: string;
  text: string;
  from: string;
}
const fixtureSends: FixtureSend[] = [];
const fixtureServer = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://fixture");
    if (req.method === "POST" && url.pathname === "/emails") {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as FixtureSend;
      if (body.to.some((address) => address.includes("+fail"))) {
        res.writeHead(422, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "fixture rejection: +fail recipient" }));
        return;
      }
      fixtureSends.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `fixture-email-${fixtureSends.length}` }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `unknown fixture path ${url.pathname}` }));
  });
});
await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
process.env.RESEND_BASE_URL = `http://127.0.0.1:${(fixtureServer.address() as { port: number }).port}`;

const { setSetting } = await import("../lib/settings");
const { enqueueTriggeredEmail } = await import("../lib/email/triggered");
const { enqueueRefundEmailTx, sendPaymentLinkEmail } = await import("../lib/email/order-emails");
const { sweepOutbox } = await import("../lib/email/outbox-sweep");
const { purgeEmailLog } = await import("../lib/email/purge");
const { sendCampaign, testSendCampaign } = await import("../lib/email/campaigns");
const { finalizeOrder } = await import("../lib/orders/state-machine");
const { DomainRuleError } = await import("../lib/errors");
const { BRAND } = await import("../lib/brand");
const { closeAllOpenSeasons, expectThrow, reopenSeasons } = await import("./test-db-helpers.mts");

const stamp = Date.now();
const previouslyOpen = await closeAllOpenSeasons(prisma);

// Deterministic sweep aggregates: the dev DB accumulates PENDING outbox
// residue from earlier phase tests (P9 enqueued without a sweeper), which
// would otherwise be claimed by MY sweeps and pollute the counts. Everything
// wiped here is test residue that later seeds/smokes recreate.
await prisma.emailCampaignRecipient.deleteMany({});
await prisma.emailCampaign.deleteMany({});
await prisma.emailTriggeredOverride.deleteMany({});
await prisma.outboxMessage.deleteMany({});

await setSetting("email.branding", {
  fromName: "P11 Brand",
  fromEmail: "p11@example.org",
  replyToEmail: "p11-reply@example.org",
  footerText: "P11 Footer Line",
});
await setSetting("email.policy", { retentionDays: 30, maxAttempts: 3 });

const staff = await prisma.staffUser.create({
  data: { email: `p11-staff-${stamp}@example.org`, name: "P11 Staff", role: "MANAGER", status: "ACTIVE", confirmedAt: new Date() },
});
const ctx = { staff: { id: staff.id, email: staff.email }, impersonator: null };

// --- S4: triggered email → outbox → sweep over the real HTTP path --------------
const recipientA = `p11-a-${stamp}@example.org`;
const enqueued = await enqueueTriggeredEmail({
  key: "order_confirmation",
  recipient: recipientA,
  tokens: { customerName: "P11 Customer", orderRef: "TS-9001", amount: "$42.00" },
});
check("a triggered email enqueues one PENDING outbox row", enqueued.status === "queued");
const pendingRow = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: (enqueued as { outboxId: string }).outboxId } });
check(
  "the outbox row stores the exact branded bytes (subject + footer + tokens)",
  pendingRow.status === "PENDING" &&
    pendingRow.subject?.includes("P11 Brand") === true &&
    pendingRow.subject?.includes("TS-9001") === true &&
    pendingRow.body.includes("$42.00") &&
    pendingRow.body.includes("P11 Footer Line"),
);

const sweep1 = await sweepOutbox();
check("the sweep delivers the pending row through the fixture (live path, not capture)", sweep1.sent === 1 && sweep1.captured === 0);
const sentRow = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: pendingRow.id } });
check(
  "the delivered row records provider id + one attempt + no error",
  sentRow.status === "SENT" && sentRow.providerId?.startsWith("resend:fixture-email-") === true && sentRow.attempts === 1 && sentRow.lastError === null && sentRow.sentAt !== null,
);
check(
  "the fixture received the branded send",
  fixtureSends.length === 1 && fixtureSends[0].to.includes(recipientA) && fixtureSends[0].subject.includes("TS-9001") && fixtureSends[0].from === "P11 Brand <p11@example.org>",
);
const sweep2 = await sweepOutbox();
check("a second sweep never redelivers a SENT row (S4 one-claim law)", sweep2.claimed === 0 && fixtureSends.length === 1);

// --- Retry/backoff to exhaustion ---------------------------------------------------
const recipientFail = `p11-fail+fail-${stamp}@example.org`;
await enqueueTriggeredEmail({ key: "order_confirmation", recipient: recipientFail, tokens: { customerName: "F", orderRef: "TS-9002", amount: "$1.00" } });
const failSweep1 = await sweepOutbox();
check("a provider rejection lands FAILED with the error trail", failSweep1.failed === 1);
const failRow = await prisma.outboxMessage.findFirstOrThrow({ where: { toAddress: recipientFail } });
check(
  "the failed row records attempt 1 + the provider message",
  failRow.status === "FAILED" && failRow.attempts === 1 && (failRow.lastError ?? "").includes("fixture rejection"),
);
await sweepOutbox();
await sweepOutbox();
const exhausted = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: failRow.id } });
check("the sweeper retries FAILED rows up to maxAttempts", exhausted.attempts === 3 && exhausted.status === "FAILED");
const sweepAfterExhaustion = await sweepOutbox();
check("an exhausted row is never claimed again", sweepAfterExhaustion.claimed === 0);

// --- G-021: SMS rows capture honestly with no TWILIO_* -------------------------------
await prisma.outboxMessage.create({
  data: { kind: "delivery_reminder", channel: "SMS", toAddress: "+15550001111", body: `p11 sms ${stamp}` },
});
const smsSweep = await sweepOutbox();
const smsRow = await prisma.outboxMessage.findFirstOrThrow({ where: { channel: "SMS", toAddress: "+15550001111" } });
check(
  "an SMS outbox row sweeps to SENT via capture (no keys, no provider)",
  smsSweep.captured === 1 && smsRow.status === "SENT" && smsRow.providerId?.startsWith("capture:sms:") === true,
);

// --- R-086: triggered overrides — disable, then resolution order ---------------------
await prisma.emailTriggeredOverride.create({ data: { key: "refund_issued", enabled: false } });
const suppressed = await enqueueTriggeredEmail({ key: "refund_issued", recipient: `p11-s-${stamp}@example.org`, tokens: { customerName: "S", orderRef: "TS-1", amount: "$1.00" } });
check(
  "a disabled key suppresses the send entirely (no row, honest result)",
  suppressed.status === "disabled" && (await prisma.outboxMessage.count({ where: { toAddress: `p11-s-${stamp}@example.org` } })) === 0,
);
await prisma.emailTriggeredOverride.update({ where: { key: "refund_issued" }, data: { enabled: true, subjectOverride: "OVERRIDE SUBJ {{orderRef}}" } });
const overridden = await enqueueTriggeredEmail({ key: "refund_issued", recipient: `p11-o1-${stamp}@example.org`, tokens: { customerName: "O", orderRef: "TS-2", amount: "$2.00" } });
const overriddenRow = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: (overridden as { outboxId: string }).outboxId } });
check("subjectOverride beats the coded default", overriddenRow.subject === "OVERRIDE SUBJ TS-2");
const tpl = await prisma.emailTemplate.create({
  data: { key: `p11-tpl-${stamp}`, name: "P11 tpl", subject: "TPL SUBJ {{orderRef}}", bodyText: "TPL BODY {{orderRef}}" },
});
await prisma.emailTriggeredOverride.update({ where: { key: "refund_issued" }, data: { subjectOverride: null, templateId: tpl.id } });
const templated = await enqueueTriggeredEmail({ key: "refund_issued", recipient: `p11-o2-${stamp}@example.org`, tokens: { customerName: "T", orderRef: "TS-3", amount: "$3.00" } });
const templatedRow = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: (templated as { outboxId: string }).outboxId } });
check("a linked template beats the coded default", templatedRow.subject === "TPL SUBJ TS-3" && templatedRow.body === "TPL BODY TS-3");
await prisma.emailTriggeredOverride.update({ where: { key: "refund_issued" }, data: { bodyTemplateOverride: "BODY OVERRIDE {{orderRef}}" } });
const bodyOverridden = await enqueueTriggeredEmail({ key: "refund_issued", recipient: `p11-o3-${stamp}@example.org`, tokens: { customerName: "B", orderRef: "TS-4", amount: "$4.00" } });
const bodyRow = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: (bodyOverridden as { outboxId: string }).outboxId } });
check("bodyTemplateOverride is the highest-precedence body", bodyRow.body === "BODY OVERRIDE TS-4");
// Later scenarios exercise the coded default path — clear the override.
await prisma.emailTriggeredOverride.delete({ where: { key: "refund_issued" } });

// --- R-083/R-089: campaign snapshot, send, rerun idempotency (S2) ---------------------
const list = await prisma.emailList.create({ data: { name: `P11 List ${stamp}` } });
async function makeSubscriber(tag: string, unsubscribed = false) {
  return prisma.newsletterSubscriber.create({
    data: {
      email: `p11-${tag}-${stamp}@example.org`,
      name: tag,
      unsubscribedAt: unsubscribed ? new Date() : null,
      listMemberships: { create: { listId: list.id } },
    },
  });
}
const sub1 = await makeSubscriber("s1");
await makeSubscriber("s2");
await makeSubscriber("s3", true);
const campaign = await prisma.emailCampaign.create({
  data: { name: `P11 Campaign ${stamp}`, subject: "Shabbos news {{customerName}}", bodyText: "Body for {{customerName}}\n\n{{footer}}", listId: list.id },
});
const sendsBeforeCampaign = fixtureSends.length;
const send1 = await sendCampaign({ campaignId: campaign.id, ctx });
check(
  "the send snapshots the list and skips the unsubscribed member provably",
  send1.snapshotted === 3 && send1.skipped === 1 && send1.sent === 2 && send1.failed === 0 && send1.status === "SENT",
);
const recipientRows = await prisma.emailCampaignRecipient.findMany({ where: { campaignId: campaign.id } });
check(
  "recipient rows record SENT with provider ids / SKIPPED for the unsubscribe",
  recipientRows.length === 3 &&
    recipientRows.filter((row) => row.status === "SENT").every((row) => row.providerId?.startsWith("resend:fixture-email-")) &&
    recipientRows.some((row) => row.status === "SKIPPED"),
);
check("the fixture delivered exactly the two subscribed recipients", fixtureSends.length === sendsBeforeCampaign + 2);
const send2 = await sendCampaign({ campaignId: campaign.id, ctx });
check(
  "a rerun never re-delivers (S2: zero new sends, zero failures)",
  send2.sent === 0 && send2.failed === 0 && send2.alreadySent === 2 && fixtureSends.length === sendsBeforeCampaign + 2,
);
const sub4 = await makeSubscriber("s4");
const send3 = await sendCampaign({ campaignId: campaign.id, ctx });
check(
  "a rerun reaches ONLY the member who joined after the first send",
  send3.sent === 1 && fixtureSends.length === sendsBeforeCampaign + 3 && fixtureSends[fixtureSends.length - 1].to.includes(sub4.email),
);

// Campaign failure path: retryable FAILED, then permanent after exhaustion.
const failList = await prisma.emailList.create({ data: { name: `P11 Fail List ${stamp}` } });
const failGood = await prisma.newsletterSubscriber.create({
  data: { email: `p11-good-${stamp}@example.org`, listMemberships: { create: { listId: failList.id } } },
});
const failBad = await prisma.newsletterSubscriber.create({
  data: { email: `p11-bad+fail-${stamp}@example.org`, listMemberships: { create: { listId: failList.id } } },
});
const failCampaign = await prisma.emailCampaign.create({
  data: { name: `P11 Fail Campaign ${stamp}`, subject: "s", bodyText: "b", listId: failList.id },
});
const failSend1 = await sendCampaign({ campaignId: failCampaign.id, ctx });
const goodSendsAfterFirst = fixtureSends.filter((send) => send.to.includes(failGood.email)).length;
check(
  "a partial failure marks the campaign FAILED with a retry pointer",
  failSend1.sent === 1 && failSend1.failed === 1 && failSend1.status === "FAILED" && (await prisma.emailCampaign.findUniqueOrThrow({ where: { id: failCampaign.id } })).lastError?.includes("rerun") === true,
);
await sendCampaign({ campaignId: failCampaign.id, ctx });
const failSend3 = await sendCampaign({ campaignId: failCampaign.id, ctx });
const failCampaignRow = await prisma.emailCampaign.findUniqueOrThrow({ where: { id: failCampaign.id } });
check(
  "exhausted recipients stop retrying and the good recipient was never re-sent",
  failSend3.sent === 0 &&
    failCampaignRow.status === "SENT" &&
    failCampaignRow.lastError?.includes("permanently") === true &&
    fixtureSends.filter((send) => send.to.includes(failGood.email)).length === goodSendsAfterFirst &&
    (await prisma.emailCampaignRecipient.findFirstOrThrow({ where: { campaignId: failCampaign.id, subscriberId: failBad.id } })).attempts === 3,
);

// R-083 test-send: through the outbox, one immediate attempt, [test] subject.
const testSend = await testSendCampaign(campaign.id, `p11-testdest-${stamp}@example.org`);
const testRow = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: testSend.outboxId } });
check(
  "campaign test-send lands in the same outbox log with a [test] subject",
  testSend.delivered && testRow.kind === "campaign_test" && testRow.status === "SENT" && testRow.subject?.startsWith("[test] ") === true,
);

// --- R-087: order hooks — confirmation on finalize, payment link, refund --------------
const season = await prisma.season.create({ data: { name: `TEST-P11-${stamp}`, status: "OPEN" } });
await prisma.fulfillmentMethod.upsert({
  where: { code: "DELIVERY" },
  update: { active: true },
  create: { code: "DELIVERY", label: "Delivery", stages: ["NEW", "PRINTED", "PACKED", "SENT"], terminalStage: "SENT" },
});
const product = await prisma.product.create({
  data: { slug: `p11-box-${stamp}`, name: "P11 Box", basePriceCents: 2000, seasonId: season.id, trackInventory: true },
});
await prisma.inventoryItem.create({ data: { productId: product.id, onHand: 50 } });
const customer = await prisma.customer.create({ data: { email: `p11-cust-${stamp}@example.org`, name: "P11 Customer" } });
const order = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P11-${stamp}`, totalCents: 2000 },
});
const draftRecipient = await prisma.draftRecipient.create({
  data: { orderId: order.id, name: "Bubby", line1: "9 Hilltop Rd", city: "Lakewood", region: "NJ", postalCode: "08701", fulfillmentChoice: "PICKUP" },
});
await prisma.orderLine.create({
  data: { orderId: order.id, recipientId: draftRecipient.id, productId: product.id, productName: "P11 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(order.id);
const confirmationRow = await prisma.outboxMessage.findFirst({ where: { kind: "order_confirmation", orderId: order.id } });
check(
  "finalize enqueues the branded order confirmation in the same commit",
  confirmationRow !== null &&
    confirmationRow.status === "PENDING" &&
    confirmationRow.toAddress === customer.email &&
    confirmationRow.subject?.includes("P11 Brand") === true &&
    confirmationRow.body.includes("$20.00"),
);

const payLink = await sendPaymentLinkEmail({ orderId: order.id, payBaseUrl: "http://127.0.0.1:3106", ctx });
const payLinkRow = await prisma.outboxMessage.findFirst({ where: { kind: "payment_link", orderId: order.id } });
check(
  "the staff payment-link action enqueues the balance email with the order URL",
  payLink.outboxId !== null &&
    payLinkRow !== null &&
    payLinkRow.body.includes(`/account/orders/${order.id}`) &&
    payLinkRow.body.includes("$20.00") &&
    (await prisma.auditLog.count({ where: { action: "payment_link_email", targetId: order.id } })) === 1,
);
await prisma.payment.create({ data: { orderId: order.id, method: "CASH", amountCents: 2000, status: "POSTED" } });
check(
  "a fully paid order refuses the payment-link email as a clean rule violation",
  await expectThrow(() => sendPaymentLinkEmail({ orderId: order.id, payBaseUrl: "http://127.0.0.1:3106", ctx }), DomainRuleError),
);

await prisma.$transaction(async (tx) => {
  await enqueueRefundEmailTx(tx, { order, customer: { name: customer.name, email: customer.email }, amountCents: 500, stripeRefundId: `re_p11_${stamp}` });
});
const refundRow = await prisma.outboxMessage.findFirst({ where: { kind: "refund_issued", orderId: order.id } });
check(
  "the refund hook enqueues inside the domain transaction with the refund ref in metadata",
  refundRow !== null &&
    refundRow.toAddress === customer.email &&
    refundRow.body.includes("$5.00") &&
    (refundRow.metadata as { stripeRefundId?: string } | null)?.stripeRefundId === `re_p11_${stamp}`,
);

// --- R-172: retention purge -------------------------------------------------------------
const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
await prisma.outboxMessage.createMany({
  data: [
    { kind: "order_confirmation", channel: "EMAIL", toAddress: `p11-old1-${stamp}@example.org`, body: "old", status: "SENT", createdAt: oldDate },
    { kind: "order_confirmation", channel: "EMAIL", toAddress: `p11-old2-${stamp}@example.org`, body: "old", status: "SENT", createdAt: oldDate },
    { kind: "order_confirmation", channel: "EMAIL", toAddress: `p11-old3-${stamp}@example.org`, body: "old", status: "FAILED", createdAt: oldDate },
    { kind: "order_confirmation", channel: "EMAIL", toAddress: `p11-old4-${stamp}@example.org`, body: "old", status: "PENDING", createdAt: oldDate },
  ],
});
const purgeSub = await prisma.newsletterSubscriber.create({ data: { email: `p11-purge-${stamp}@example.org` } });
const purgeSubFailed = await prisma.newsletterSubscriber.create({ data: { email: `p11-purgef-${stamp}@example.org` } });
await prisma.emailCampaignRecipient.create({
  data: { campaignId: campaign.id, subscriberId: purgeSub.id, email: purgeSub.email, status: "SENT", createdAt: oldDate },
});
await prisma.emailCampaignRecipient.create({
  data: { campaignId: campaign.id, subscriberId: purgeSubFailed.id, email: purgeSubFailed.email, status: "FAILED", createdAt: oldDate },
});
const purgeResult = await purgeEmailLog();
check(
  "the purge removes only old SENT rows (outbox + recipients)",
  purgeResult.purgedOutbox === 2 && purgeResult.purgedRecipients === 1,
);
check(
  "FAILED and PENDING rows survive the purge (failure trail + active outbox)",
  (await prisma.outboxMessage.count({ where: { toAddress: { in: [`p11-old3-${stamp}@example.org`, `p11-old4-${stamp}@example.org`] } } })) === 2 &&
    (await prisma.emailCampaignRecipient.count({ where: { subscriberId: purgeSubFailed.id } })) === 1,
);
const purgeRun = await prisma.cronRun.findFirstOrThrow({ where: { id: purgeResult.cronRunId } });
check("the purge leaves a durable CronRun record", purgeRun.status === "OK" && (purgeRun.message ?? "").includes("purged 2"));

// Cleanup: restore seeded branding/policy, close our season, restore prior state.
await setSetting("email.branding", {
  fromName: BRAND.orgName,
  fromEmail: BRAND.supportEmail,
  replyToEmail: BRAND.supportEmail,
  footerText: `${BRAND.orgName} · ${BRAND.supportEmail}\nManage your email preferences anytime with the link in any of our emails.`,
});
await setSetting("email.policy", { retentionDays: 90, maxAttempts: 5 });
await prisma.season.update({ where: { id: season.id }, data: { status: "CLOSED" } });
await reopenSeasons(prisma, previouslyOpen);
fixtureServer.close();
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} P11 domain check(s) failed`);
  process.exit(1);
}
console.log("All P11 domain checks passed");
