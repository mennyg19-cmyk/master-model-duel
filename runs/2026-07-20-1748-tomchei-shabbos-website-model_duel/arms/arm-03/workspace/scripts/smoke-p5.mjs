import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient, AuditAction, OrderStatus } from "@prisma/client";
import { createHmac } from "node:crypto";

const base = process.env.APP_URL || "http://127.0.0.1:3103";
const evidence = [];
const db = new PrismaClient();

function cookieHeader(userId, extra = "") {
  const parts = [`dev_user_id=${userId}`];
  if (extra) parts.push(extra);
  return { cookie: parts.join("; ") };
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

function sign(payload, secret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_mock_dev_only") {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

async function resetStock() {
  for (const [sku, onHand] of [
    ["FAMILY-BOX", 25],
    ["TOTE", 40],
    ["LIMITED-BOX", 0],
  ]) {
    const p = await db.product.findFirst({ where: { sku } });
    if (p) {
      await db.inventoryItem.updateMany({
        where: { productId: p.id },
        data: { onHand, reserved: 0 },
      });
    }
  }
}

async function discardCustomerDrafts(customerId) {
  await db.order.updateMany({
    where: { customerId, status: OrderStatus.DRAFT },
    data: { status: OrderStatus.DISCARDED, discardedAt: new Date() },
  });
}

async function createAssignedDraft(customerCookie, recipients) {
  const products = await db.product.findMany({
    where: { sku: { in: ["FAMILY-BOX", "TOTE"] }, isActive: true },
    include: { options: true },
  });
  const family = products.find((p) => p.sku === "FAMILY-BOX");
  if (!family) throw new Error("FAMILY-BOX missing");

  const create = await req("/api/drafts", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(customerCookie) },
    body: JSON.stringify({}),
  });
  const draftRef = create.json?.draft?.draftRef;
  if (!draftRef) throw new Error("draft create failed");

  const lineIds = [];
  for (let i = 0; i < recipients.length; i++) {
    const add = await req(`/api/drafts/${draftRef}/lines`, {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader(customerCookie) },
      body: JSON.stringify({
        productId: family.id,
        productOptionId: family.options[0]?.id,
        quantity: 1,
      }),
    });
    const line = add.json?.draft?.lines?.find((l) => !lineIds.includes(l.id) && !l.assigned) ??
      add.json?.draft?.lines?.[add.json.draft.lines.length - 1];
    if (!line) throw new Error("line add failed");
    lineIds.push(line.id);

    const r = recipients[i];
    const assign = await req(`/api/drafts/${draftRef}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader(customerCookie) },
      body: JSON.stringify({
        lineId: line.id,
        mode: "new_recipient",
        autoSaveNew: true,
        newRecipient: {
          recipientName: r.name,
          line1: r.line1,
          city: r.city,
          state: r.state,
          postalCode: r.zip,
          country: "US",
        },
      }),
    });
    if (!assign.json?.ok) throw new Error(`assign failed: ${JSON.stringify(assign.json)}`);
  }

  const draft = await req(`/api/drafts/${draftRef}`, {
    headers: cookieHeader(customerCookie),
  });
  return { draftRef, draft: draft.json.draft, lineIds: draft.json.draft.lines.map((l) => l.id) };
}

async function main() {
  await resetStock();
  const customer = await db.customer.findFirst({ where: { clerkUserId: "dev_customer_1" } });
  if (!customer) throw new Error("Seed customer missing");
  await discardCustomerDrafts(customer.id);

  // --- S1: Stripe web checkout + webhook replay ---
  const s1 = await createAssignedDraft("dev_customer_1", [
    { name: "A One", line1: "10 A St", city: "Brooklyn", state: "NY", zip: "11218" },
    { name: "B Two", line1: "20 B St", city: "Brooklyn", state: "NY", zip: "11219" },
  ]);
  const prep1 = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s1.draftRef,
      greetingDefault: "Chag Sameach",
      recipients: s1.lineIds.map((id, i) => ({
        lineIds: [id],
        fulfillmentMethodCode: "PICKUP",
        greeting: i === 0 ? "Hello A" : null,
      })),
    }),
  });
  const start1 = await req("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s1.draftRef,
      clientExpectedTotalCents: prep1.json?.summary?.totalCents,
    }),
  });
  const sessionId = start1.json?.sessionId;
  const orderRow = await db.order.findUnique({ where: { draftRef: s1.draftRef } });
  const amount = start1.json?.amountCents;
  const eventBody = JSON.stringify({
    id: `evt_smoke_s1_${Date.now()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        amount_total: amount,
        payment_intent: `pi_smoke_${Date.now()}`,
        metadata: { orderId: orderRow.id },
      },
    },
  });
  const wh1 = await req("/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sign(eventBody) },
    body: eventBody,
  });
  const wh1b = await req("/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sign(eventBody) },
    body: eventBody,
  });
  const after = await db.order.findUnique({
    where: { id: orderRow.id },
    include: { payments: true, packages: true },
  });
  const inv = await db.inventoryItem.findFirst({
    where: { product: { sku: "FAMILY-BOX" } },
  });
  const s1Pass =
    wh1.json?.ok &&
    wh1b.json?.ok &&
    wh1b.json?.replay === true &&
    after.status !== OrderStatus.DRAFT &&
    after.orderNumber != null &&
    after.payments.filter((p) => p.state === "POSTED" && p.method === "STRIPE").length === 1 &&
    inv.reserved >= 2;
  push("S1", "Stripe web checkout + webhook replay → one order/payment/stock", s1Pass, {
    status: after.status,
    orderNumber: after.orderNumber,
    payments: after.payments.length,
    reserved: inv.reserved,
    replay: wh1b.json?.replay,
  });

  // --- S2: Delivery fees + zip block ---
  await discardCustomerDrafts(customer.id);
  await resetStock();
  const s2bulk = await createAssignedDraft("dev_customer_1", [
    { name: "Bulk1", line1: "1 Dest A", city: "Brooklyn", state: "NY", zip: "11218" },
    { name: "Bulk2", line1: "2 Dest B", city: "Brooklyn", state: "NY", zip: "11219" },
  ]);
  const prepBulk = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s2bulk.draftRef,
      recipients: s2bulk.lineIds.map((id) => ({
        lineIds: [id],
        fulfillmentMethodCode: "BULK_DELIVERY",
        purimDay: "2026-03-13",
      })),
    }),
  });
  const bulkFees = prepBulk.json?.summary?.fees;
  const bulkOk =
    bulkFees?.bulkDestinationCount === 2 && bulkFees?.bulkFeeCents === 1000;

  await discardCustomerDrafts(customer.id);
  const s2pkg = await createAssignedDraft("dev_customer_1", [
    { name: "P1", line1: "1 A", city: "Brooklyn", state: "NY", zip: "11218" },
    { name: "P2", line1: "2 B", city: "Brooklyn", state: "NY", zip: "11218" },
    { name: "P3", line1: "3 C", city: "Brooklyn", state: "NY", zip: "11219" },
  ]);
  const prepPkg = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s2pkg.draftRef,
      recipients: s2pkg.lineIds.map((id) => ({
        lineIds: [id],
        fulfillmentMethodCode: "PER_PACKAGE_DELIVERY",
        purimDay: "2026-03-14",
      })),
    }),
  });
  const pkgFees = prepPkg.json?.summary?.fees;
  const pkgOk =
    pkgFees?.perPackageRecipientCount === 3 && pkgFees?.perPackageFeeCents === 2400;

  await discardCustomerDrafts(customer.id);
  const s2block = await createAssignedDraft("dev_customer_1", [
    { name: "Far", line1: "9 Far Rd", city: "Albany", state: "NY", zip: "12207" },
  ]);
  const prepBlock = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s2block.draftRef,
      recipients: [
        {
          lineIds: s2block.lineIds,
          fulfillmentMethodCode: "PER_PACKAGE_DELIVERY",
          purimDay: "2026-03-13",
        },
      ],
    }),
  });
  const blocked =
    prepBlock.json?.conflicts?.some((c) => c.kind === "zip_blocked") ||
    prepBlock.json?.summary?.fees?.blockedZips?.length > 0 ||
    prepBlock.json?.ok === false;
  push("S2", "Delivery fees + zip block", Boolean(bulkOk && pkgOk && blocked), {
    bulkFees,
    pkgFees,
    blocked,
  });

  // --- S3: Stale price/stock ---
  await discardCustomerDrafts(customer.id);
  await resetStock();
  const s3 = await createAssignedDraft("dev_customer_1", [
    { name: "Stale", line1: "1 S", city: "Brooklyn", state: "NY", zip: "11218" },
  ]);
  await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s3.draftRef,
      recipients: [
        { lineIds: s3.lineIds, fulfillmentMethodCode: "PICKUP" },
      ],
    }),
  });
  const family = await db.product.findFirst({ where: { sku: "FAMILY-BOX" } });
  await db.product.update({
    where: { id: family.id },
    data: { basePriceCents: family.basePriceCents + 500 },
  });
  const stale = await req("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s3.draftRef,
      clientExpectedTotalCents: 1,
    }),
  });
  await db.product.update({
    where: { id: family.id },
    data: { basePriceCents: 5400 },
  });
  const staleOk =
    stale.status === 409 &&
    (stale.json?.conflicts?.some((c) =>
      ["stale_price", "stale_total", "stock"].includes(c.kind),
    ) ||
      stale.json?.ok === false);
  push("S3", "Stale price/stock refused", Boolean(staleOk), {
    status: stale.status,
    conflicts: stale.json?.conflicts,
  });

  // --- S4: POS cash/check + public reject ---
  await discardCustomerDrafts(customer.id);
  await resetStock();
  const s4 = await createAssignedDraft("dev_customer_1", [
    { name: "POS", line1: "1 P", city: "Brooklyn", state: "NY", zip: "11218" },
  ]);
  // Staff must own/access draft — use admin cookie + prepare via offline
  const publicCash = await req("/api/checkout/offline", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s4.draftRef,
      method: "CASH",
      amountCents: 5400,
      recipients: [{ lineIds: s4.lineIds, fulfillmentMethodCode: "PICKUP" }],
    }),
  });
  const staffCash = await req("/api/checkout/offline", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      draftRef: s4.draftRef,
      method: "CASH",
      amountCents: undefined,
      recipients: [{ lineIds: s4.lineIds, fulfillmentMethodCode: "PICKUP" }],
    }),
  });
  // Fix: need amount from prepare first
  const prepPos = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      draftRef: s4.draftRef,
      recipients: [{ lineIds: s4.lineIds, fulfillmentMethodCode: "PICKUP" }],
    }),
  });
  const staffCash2 = await req("/api/checkout/offline", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      draftRef: s4.draftRef,
      method: "CASH",
      amountCents: prepPos.json?.summary?.totalCents,
      recipients: [{ lineIds: s4.lineIds, fulfillmentMethodCode: "PICKUP" }],
    }),
  });

  await discardCustomerDrafts(customer.id);
  const s4b = await createAssignedDraft("dev_customer_1", [
    { name: "CHK", line1: "2 P", city: "Brooklyn", state: "NY", zip: "11218" },
  ]);
  const prepCheck = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      draftRef: s4b.draftRef,
      recipients: [{ lineIds: s4b.lineIds, fulfillmentMethodCode: "PICKUP" }],
    }),
  });
  const staffCheck = await req("/api/checkout/offline", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      draftRef: s4b.draftRef,
      method: "CHECK",
      amountCents: prepCheck.json?.summary?.totalCents,
      reference: "CHK-100",
      recipients: [{ lineIds: s4b.lineIds, fulfillmentMethodCode: "PICKUP" }],
    }),
  });
  const paymentId = staffCheck.json?.payment?.id;
  const voidRes = await req("/api/checkout/offline", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ paymentId, reason: "smoke void" }),
  });
  const cashAudit = await db.auditLog.count({
    where: { action: { in: [AuditAction.PAYMENT_POSTED, AuditAction.PAYMENT_VOIDED] } },
  });
  const s4Pass =
    (publicCash.status === 401 || publicCash.status === 403) &&
    staffCash2.json?.ok === true &&
    staffCheck.json?.ok === true &&
    voidRes.json?.ok === true &&
    cashAudit >= 3;
  push("S4", "POS cash/check post+void; public reject", Boolean(s4Pass), {
    publicStatus: publicCash.status,
    cashOk: staffCash2.json?.ok,
    checkOk: staffCheck.json?.ok,
    voidOk: voidRes.json?.ok,
    audits: cashAudit,
    staffCashFirst: staffCash.status,
  });

  // --- S5: Order lifecycle ---
  await discardCustomerDrafts(customer.id);
  await resetStock();
  const s5 = await createAssignedDraft("dev_customer_1", [
    { name: "Life", line1: "9 L", city: "Brooklyn", state: "NY", zip: "11218" },
  ]);
  const prepLife = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s5.draftRef,
      recipients: [{ lineIds: s5.lineIds, fulfillmentMethodCode: "PICKUP" }],
    }),
  });
  const start5 = await req("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s5.draftRef,
      clientExpectedTotalCents: prepLife.json?.summary?.totalCents,
    }),
  });
  const order5 = await db.order.findUnique({ where: { draftRef: s5.draftRef } });
  const evt5 = JSON.stringify({
    id: `evt_smoke_s5_${Date.now()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: start5.json.sessionId,
        amount_total: start5.json.amountCents,
        payment_intent: `pi_s5_${Date.now()}`,
        metadata: { orderId: order5.id },
      },
    },
  });
  await req("/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sign(evt5) },
    body: evt5,
  });
  const placed = await db.order.findUnique({ where: { id: order5.id } });
  const badTransition = await req("/api/orders/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      orderId: order5.id,
      action: "transition",
      to: "DRAFT",
    }),
  });
  const discardDraft = await createAssignedDraft("dev_customer_1", [
    { name: "Dump", line1: "1 D", city: "Brooklyn", state: "NY", zip: "11218" },
  ]);
  const discardOrder = await db.order.findUnique({ where: { draftRef: discardDraft.draftRef } });
  const discarded = await req("/api/orders/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ orderId: discardOrder.id, action: "discard" }),
  });
  const recalc = await req("/api/orders/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ orderId: order5.id, action: "recalc_payment" }),
  });

  // Safety refund path: wrong amount
  await discardCustomerDrafts(customer.id);
  await resetStock();
  const s5safe = await createAssignedDraft("dev_customer_1", [
    { name: "Safe", line1: "1 X", city: "Brooklyn", state: "NY", zip: "11218" },
  ]);
  const prepSafe = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s5safe.draftRef,
      recipients: [{ lineIds: s5safe.lineIds, fulfillmentMethodCode: "PICKUP" }],
    }),
  });
  const startSafe = await req("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef: s5safe.draftRef,
      clientExpectedTotalCents: prepSafe.json?.summary?.totalCents,
    }),
  });
  const orderSafe = await db.order.findUnique({ where: { draftRef: s5safe.draftRef } });
  const evtSafe = JSON.stringify({
    id: `evt_smoke_safe_${Date.now()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: startSafe.json.sessionId,
        amount_total: (startSafe.json.amountCents || 0) + 999,
        payment_intent: `pi_safe_${Date.now()}`,
        metadata: { orderId: orderSafe.id },
      },
    },
  });
  await req("/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sign(evtSafe) },
    body: evtSafe,
  });
  const safeOrder = await db.order.findUnique({ where: { id: orderSafe.id } });
  const safetyAudit = await db.auditLog.count({
    where: { action: AuditAction.SAFETY_REFUND },
  });

  const s5Pass =
    placed.orderNumber != null &&
    placed.paymentStatusCached === "PAID" &&
    badTransition.status === 409 &&
    discarded.json?.ok === true &&
    recalc.json?.ok === true &&
    safeOrder.status === OrderStatus.DRAFT &&
    safetyAudit >= 1;
  push("S5", "Lifecycle transitions, numbering, discard, safety refund, payment recalc", Boolean(s5Pass), {
    orderNumber: placed.orderNumber,
    paymentStatus: placed.paymentStatusCached,
    badTransition: badTransition.status,
    discarded: discarded.json?.ok,
    recalc: recalc.json?.paymentStatus,
    safetyStillDraft: safeOrder.status,
    safetyAudit,
  });

  const passed = evidence.filter((e) => e.pass).length;
  const total = evidence.length;
  const ok = passed === total;
  const out = {
    ok,
    passed,
    total,
    failed: evidence.filter((e) => !e.pass).map((e) => e.id),
    evidence,
  };

  const scratch = path.join(process.cwd(), ".scratch");
  await mkdir(scratch, { recursive: true });
  const md = [
    "# PHASE-P5 smoke evidence",
    "",
    `Run at: ${new Date().toISOString()}`,
    `Base: ${base}`,
    `Result: ${ok ? "PASS" : "FAIL"} (${passed}/${total})`,
    "",
    "| ID | Check | Pass |",
    "|---|---|---|",
    ...evidence.map((e) => `| ${e.id} | ${e.check} | ${e.pass ? "PASS" : "FAIL"} |`),
    "",
    "```json",
    JSON.stringify(out, null, 2),
    "```",
    "",
  ].join("\n");
  await writeFile(path.join(scratch, "PHASE-P5-SMOKE.md"), md, "utf8");
  console.log(JSON.stringify(out, null, 2));
  if (!ok) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
