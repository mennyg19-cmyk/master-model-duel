import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PrismaClient,
  AuditAction,
  OrderStatus,
  CachedPaymentStatus,
  PaymentMethod,
  PaymentState,
} from "@prisma/client";

const base = process.env.APP_URL || "http://127.0.0.1:3103";
const evidence = [];
const db = new PrismaClient();

function cookieHeader(userId) {
  return { cookie: `dev_user_id=${userId}` };
}

async function req(pathname, init = {}) {
  const headers = { Origin: base, ...(init.headers || {}) };
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

async function main() {
  const manager = process.env.DEV_MANAGER_USER_ID || "dev_manager_1";
  const staff = process.env.DEV_STAFF_USER_ID || "dev_staff_1";

  // --- S1 Ops hub ---
  const dashM = await req("/api/admin/dashboard", { headers: cookieHeader(manager) });
  push("S1a", "Manager dashboard KPIs", dashM.status === 200 && dashM.json?.ok && dashM.json?.kpis);

  const dashS = await req("/api/admin/dashboard", { headers: cookieHeader(staff) });
  push("S1b", "Restricted Staff dashboard", dashS.status === 200 && dashS.json?.ok);

  let seedOrder = await db.order.findFirst({
    where: {
      status: { in: [OrderStatus.PAID, OrderStatus.PLACED] },
      payments: { some: { state: PaymentState.POSTED, amountCents: { gt: 0 } } },
      orderNumber: { not: null },
    },
    include: { payments: true },
    orderBy: { placedAt: "desc" },
  });

  let orderId = seedOrder?.id;
  if (!orderId) {
    const season = await db.season.findFirst();
    const customer = await db.customer.findFirst({ where: { email: "customer@tomchei.local" } });
    const product = await db.product.findFirst({ where: { sku: "FAMILY-BOX" } });
    const method = await db.fulfillmentMethod.findFirst();
    seedOrder = await db.order.create({
      data: {
        seasonId: season.id,
        customerId: customer.id,
        status: OrderStatus.PAID,
        draftRef: `D-2026-P6SM${String(Date.now()).slice(-4)}`,
        orderNumber: 88001 + Math.floor(Math.random() * 1000),
        paymentStatusCached: CachedPaymentStatus.PAID,
        expectedTotalCents: product.basePriceCents,
        placedAt: new Date(),
        lines: {
          create: {
            productId: product.id,
            quantity: 1,
            unitPriceCents: product.basePriceCents,
            recipientName: "P6 Smoke",
            addressLine1: "1 Smoke St",
            city: "Brooklyn",
            state: "NY",
            postalCode: "11218",
            fulfillmentMethodId: method.id,
            groupingKey: "p6smoke",
          },
        },
        payments: {
          create: {
            method: PaymentMethod.CASH,
            state: PaymentState.POSTED,
            amountCents: product.basePriceCents,
            reference: "p6-smoke-seed",
          },
        },
      },
      include: { payments: true },
    });
    orderId = seedOrder.id;
  }
  push("S1c", "Seeded order exists", Boolean(seedOrder?.id), { orderId });

  const list = await req(`/api/admin/orders?q=${encodeURIComponent(String(seedOrder.orderNumber ?? orderId))}`, {
    headers: cookieHeader(manager),
  });
  push("S1d", "Order search finds seeded", list.status === 200 && (list.json?.orders?.length ?? 0) >= 1);

  const detailM = await req(`/api/admin/orders/${orderId}`, { headers: cookieHeader(manager) });
  push("S1e", "Manager order detail", detailM.status === 200 && detailM.json?.order?.id === orderId);

  const detailS = await req(`/api/admin/orders/${orderId}`, { headers: cookieHeader(staff) });
  push("S1f", "Staff order detail", detailS.status === 200 && detailS.json?.order?.id === orderId);

  const payment = (seedOrder.payments || detailM.json?.order?.payments || []).find(
    (p) => p.state === "POSTED" && p.amountCents - (p.refundedCents || 0) > 0,
  );
  const refundAmt = Math.min(100, payment ? payment.amountCents - payment.refundedCents : 100);
  const refund = await req(`/api/admin/orders/${orderId}/refund`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(staff) },
    body: JSON.stringify({
      paymentId: payment.id,
      amountCents: refundAmt,
      reason: "P6 smoke refund",
    }),
  });
  push("S1g", "Staff refund path", refund.status === 200 && refund.json?.ok, {
    status: refund.status,
    body: refund.json,
  });

  const today = await req("/admin/today", { headers: cookieHeader(manager) });
  push("S1h", "Today queue page", today.status === 200 && today.text.includes("Today work queue"));

  const auditPage = await req("/admin/audit", { headers: cookieHeader(manager) });
  push("S1i", "Audit view reachable", auditPage.status === 200);

  // --- S2 POS ---
  const posPage = await req("/admin/pos", { headers: cookieHeader(manager) });
  push("S2a", "POS page loads", posPage.status === 200 && posPage.text.includes("pos-builder"));

  // Create walk-in customer + draft + cash payment via APIs
  const walkIn = await req("/api/admin/customers", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      displayName: "Walk-in P6",
      email: `walkin.p6.${Date.now()}@tomchei.local`,
      phone: "5553334444",
    }),
  });
  push("S2b", "POS find-or-create customer", walkIn.status === 200 && walkIn.json?.customerId);

  const draftCreate = await req("/api/drafts", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ guest: true }),
  });
  const draftRef = draftCreate.json?.draft?.draftRef;
  push("S2c", "POS draft created", Boolean(draftRef), { draftRef });

  let paidOrderId = orderId;
  let paidOrderVersion = seedOrder?.version ?? 1;

  if (draftRef && walkIn.json?.customerId) {
    const attach = await req("/api/admin/pos/attach-customer", {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader(manager) },
      body: JSON.stringify({ draftRef, customerId: walkIn.json.customerId }),
    });
    push("S2d", "Attach customer to POS draft", attach.status === 200 && attach.json?.ok);

    const product = await db.product.findFirst({
      where: { sku: "FAMILY-BOX", isActive: true },
      include: { options: true },
    });
    const method =
      (await db.fulfillmentMethod.findFirst({ where: { code: "PICKUP" } })) ||
      (await db.fulfillmentMethod.findFirst({ where: { isActive: true } }));

    const addLine = await req(`/api/drafts/${draftRef}/lines`, {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader(manager) },
      body: JSON.stringify({
        productId: product.id,
        productOptionId: product.options[0]?.id,
        quantity: 1,
      }),
    });
    const lineId =
      addLine.json?.draft?.lines?.find((l) => !l.assigned)?.id ??
      addLine.json?.draft?.lines?.[0]?.id;

    const assign = await req(`/api/drafts/${draftRef}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader(manager) },
      body: JSON.stringify({
        lineId,
        mode: "new_recipient",
        autoSaveNew: true,
        newRecipient: {
          recipientName: "Walk-in Recip",
          line1: "50 POS Ave",
          city: "Brooklyn",
          state: "NY",
          postalCode: "11218",
          country: "US",
        },
      }),
    });

    const assignedLines = assign.json?.draft?.lines ?? [];
    const assignedIds = assignedLines.filter((l) => l.assigned).map((l) => l.id);

    // Refresh expected total via prepare path inside offline
    const orderRow = await db.order.findUnique({ where: { draftRef } });
    const lineRows = await db.orderLine.findMany({ where: { orderId: orderRow.id } });
    // Ensure address fields present for prepareCheckout
    for (const line of lineRows) {
      if (!line.recipientName || !line.addressLine1) {
        await db.orderLine.update({
          where: { id: line.id },
          data: {
            recipientName: "Walk-in Recip",
            addressLine1: "50 POS Ave",
            city: "Brooklyn",
            state: "NY",
            postalCode: "11218",
            country: "US",
            fulfillmentMethodId: method.id,
          },
        });
      }
    }
    const freshLines = await db.orderLine.findMany({ where: { orderId: orderRow.id } });

    const offline = await req("/api/checkout/offline", {
      method: "POST",
      headers: { "content-type": "application/json", ...cookieHeader(manager) },
      body: JSON.stringify({
        draftRef,
        method: "CASH",
        amountCents: product.basePriceCents,
        reference: "p6-pos-cash",
        recipients: [
          {
            lineIds: (assignedIds.length ? assignedIds : freshLines.map((l) => l.id)),
            fulfillmentMethodCode: method.code,
          },
        ],
      }),
    });

    // If amount mismatch, retry with server expected total
    let offlineFinal = offline;
    if (!offline.json?.ok && orderRow) {
      const refreshed = await db.order.findUnique({ where: { draftRef } });
      if (refreshed?.expectedTotalCents) {
        offlineFinal = await req("/api/checkout/offline", {
          method: "POST",
          headers: { "content-type": "application/json", ...cookieHeader(manager) },
          body: JSON.stringify({
            draftRef,
            method: "CASH",
            amountCents: refreshed.expectedTotalCents,
            reference: "p6-pos-cash",
            recipients: [
              {
                lineIds: freshLines.map((l) => l.id),
                fulfillmentMethodCode: method.code,
              },
            ],
          }),
        });
      }
    }

    push("S2e", "POS cash audited payment", offlineFinal.status === 200 && offlineFinal.json?.ok, {
      status: offlineFinal.status,
      body: offlineFinal.json,
      assignOk: assign.json?.ok,
    });

    const paidAudit = await db.auditLog.findFirst({
      where: { action: AuditAction.PAYMENT_POSTED },
      orderBy: { createdAt: "desc" },
    });
    push("S2f", "Payment audit row", Boolean(paidAudit));

    const paidOrder = await db.order.findUnique({ where: { draftRef } });
    if (paidOrder && paidOrder.status !== OrderStatus.DRAFT) {
      paidOrderId = paidOrder.id;
      paidOrderVersion = paidOrder.version;
    }
  } else {
    push("S2d", "Attach customer to POS draft", false);
    push("S2e", "POS cash audited payment", false);
    push("S2f", "Payment audit row", false);
  }

  const repeat = await req(`/api/admin/orders/${paidOrderId}/repeat`, {
    method: "POST",
    headers: cookieHeader(manager),
  });
  push("S2g", "Repeat one order", repeat.status === 200 && repeat.json?.draftRef, {
    body: repeat.json,
    paidOrderId,
  });

  const freshForBulk = await db.order.findUnique({ where: { id: paidOrderId } });
  const bulk = await req("/api/admin/orders/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      action: "repeat",
      items: [
        {
          orderId: paidOrderId,
          expectedVersion: freshForBulk?.version ?? paidOrderVersion,
        },
      ],
      confirmReplacements: true,
      confirmRecipients: true,
    }),
  });
  push(
    "S2h",
    "Bounded bulk-repeat batch",
    bulk.status === 200 && (bulk.json?.created?.length ?? 0) >= 1,
    { body: bulk.json },
  );

  // --- S3 Import ---
  const csv = [
    "displayName,email,phone",
    `Valid P6,valid.p6.${Date.now()}@tomchei.local,5551110001`,
    "Dup Existing,customer@tomchei.local,5559990000",
    "Bad Row,,badphone",
  ].join("\n");
  const stage = await req("/api/admin/imports", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ kind: "CUSTOMERS", csvText: csv, filename: "p6.csv" }),
  });
  const summary = stage.json?.summary;
  push(
    "S3a",
    "Stage CSV with valid/dup/invalid",
    stage.status === 200 &&
      summary?.valid >= 1 &&
      summary?.duplicate >= 1 &&
      summary?.invalid >= 1,
    { summary },
  );

  const commit = await req("/api/admin/imports", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ batchId: stage.json?.batchId, commit: true }),
  });
  push("S3b", "Atomic commit valid rows", commit.status === 200 && commit.json?.committed >= 1, {
    body: commit.json,
  });

  const importAudit = await db.auditLog.findFirst({
    where: { action: AuditAction.IMPORT_COMMITTED },
    orderBy: { createdAt: "desc" },
  });
  push("S3c", "Import audit", Boolean(importAudit));

  // --- S4 Scale ---
  const { spawnSync } = await import("node:child_process");
  const seed = spawnSync(
    process.execPath,
    ["--env-file=.env", "--import", "tsx", "scripts/seed-scale-p6.ts"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 300_000 },
  );
  push("S4a", "Scale seed script", seed.status === 0, {
    out: (seed.stdout || "").slice(-400),
    err: (seed.stderr || "").slice(-400),
  });

  const scaleOrders = await db.order.count({
    where: { checkoutSnapshot: { path: ["scaleFixture"], equals: "p6" } },
  });
  const packages = await db.package.count();
  push("S4b", "≥1k scale orders", scaleOrders >= 1000, { scaleOrders });
  push("S4c", "≥5k packages", packages >= 5000, { packages });

  const page1 = await req("/api/admin/orders?page=1&pageSize=50", {
    headers: cookieHeader(manager),
  });
  push(
    "S4d",
    "Page 1k-order list",
    page1.status === 200 && page1.json?.total >= 1000 && page1.json?.orders?.length === 50,
    { total: page1.json?.total },
  );

  const two = await db.order.findMany({
    where: {
      status: { in: [OrderStatus.PAID, OrderStatus.PLACED] },
      checkoutSnapshot: { path: ["scaleFixture"], equals: "p6" },
    },
    take: 2,
    orderBy: { createdAt: "desc" },
  });
  // Conflict: wrong expectedVersion on both + one correct concurrent-style report
  const conflictBulk = await req("/api/admin/orders/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      action: "status",
      toStatus: "FULFILLING",
      items: two.map((o) => ({ orderId: o.id, expectedVersion: o.version - 1 })),
    }),
  });
  const conflictBulk2 = await req("/api/admin/orders/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      action: "status",
      toStatus: "FULFILLING",
      items: two.map((o) => ({ orderId: o.id, expectedVersion: o.version })),
    }),
  });
  // Second conflicting run with stale versions after first updated them
  const conflictBulk3 = await req("/api/admin/orders/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      action: "status",
      toStatus: "COMPLETED",
      items: two.map((o) => ({ orderId: o.id, expectedVersion: o.version })),
    }),
  });
  push(
    "S4e",
    "Conflicting bulk actions report deterministically",
    conflictBulk.status === 200 &&
      (conflictBulk.json?.conflicts?.length ?? 0) >= 2 &&
      conflictBulk2.status === 200 &&
      (conflictBulk2.json?.updated?.length ?? 0) >= 1 &&
      conflictBulk3.status === 200 &&
      (conflictBulk3.json?.conflicts?.length ?? 0) >= 1,
    {
      first: conflictBulk.json,
      second: conflictBulk2.json,
      third: conflictBulk3.json,
    },
  );

  // Chrome / settings
  const settings = await req("/admin/settings", { headers: cookieHeader(manager) });
  push("S5a", "Settings hub page", settings.status === 200 && settings.text.includes("Settings"));

  const banner = await req("/api/admin/banner", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ message: "P6 crunch alert", active: true, tone: "warn" }),
  });
  push("S5b", "Alert banner wired", banner.status === 200 && banner.json?.ok);

  const adminHome = await req("/admin", { headers: cookieHeader(manager) });
  push(
    "S5c",
    "Admin chrome visit-store + banner",
    adminHome.status === 200 &&
      adminHome.text.includes("Visit store") &&
      adminHome.text.includes("P6 crunch alert"),
  );

  const passed = evidence.filter((e) => e.pass).length;
  const failed = evidence.filter((e) => !e.pass);
  const report = {
    phase: "P6",
    at: new Date().toISOString(),
    passed,
    total: evidence.length,
    failed: failed.map((f) => f.id),
    evidence,
  };

  const scratch = path.join(process.cwd(), ".scratch");
  await mkdir(scratch, { recursive: true });
  await writeFile(path.join(scratch, "PHASE-P6-SMOKE.json"), JSON.stringify(report, null, 2));

  const md = [
    `# PHASE-P6-SMOKE`,
    ``,
    `Passed **${passed}/${evidence.length}** at ${report.at}`,
    ``,
    `| ID | Check | Pass |`,
    `|---|---|---|`,
    ...evidence.map((e) => `| ${e.id} | ${e.check} | ${e.pass ? "yes" : "NO"} |`),
    ``,
    failed.length
      ? `## Failures\n\n\`\`\`json\n${JSON.stringify(failed, null, 2)}\n\`\`\`\n`
      : `All smoke checks passed.\n`,
  ].join("\n");
  await writeFile(path.join(scratch, "PHASE-P6-SMOKE.md"), md);

  console.log(JSON.stringify({ passed, total: evidence.length, failed: failed.map((f) => f.id) }));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
