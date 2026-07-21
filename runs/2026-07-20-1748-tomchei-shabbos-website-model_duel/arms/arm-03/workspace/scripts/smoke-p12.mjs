import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PrismaClient,
  OrderStatus,
  PackageStage,
  CachedPaymentStatus,
  PaymentMethod,
  PaymentState,
  ShippingLabelStatus,
  ExportDataset,
  ImportKind,
} from "@prisma/client";
import { finalizeOrder } from "../src/lib/orders/finalize";
import { buildGroupingKey } from "../src/lib/orders/grouping";
import { createLabelForPackage } from "../src/lib/shipping/labels";
import { performanceReport, marginReport } from "../src/lib/ops/reports";
import { runCsvExport } from "../src/lib/ops/exports";
import { runPaymentReconcile } from "../src/lib/ops/reconcile";
import { stageImport, commitImport, getImportBatch } from "../src/lib/ops/import";
import { runAddressCleanup } from "../src/lib/ops/address-cleanup";
import { seedImportedPriorYearOrder } from "../src/lib/ops/prior-year-stub";
import { previewRepeatOrder, confirmRepeatOrder } from "../src/lib/ops/repeat";
import { bulkAdvancePackageStage } from "../src/lib/ops/packages";
import { runNightlyPrintBatch } from "../src/lib/ops/print-batch";
import { switchFulfillmentMethod } from "../src/lib/routes/method-switch";
import { stampPickedUp } from "../src/lib/pickup/service";
import {
  getTestMode,
  setTestMode,
  wipeTestFixtures,
  reseedTestSeason,
} from "../src/lib/ops/test-ops";

const base = process.env.APP_URL || "http://127.0.0.1:3103";
const cronSecret = process.env.CRON_SECRET || "tomchei-arm03-cron-dev-only";
const evidence = [];
const db = new PrismaClient();

function cookieHeader(userId = "dev_manager_1") {
  return { cookie: `dev_user_id=${userId}` };
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

async function ensurePaidOrder(opts) {
  const {
    methodCode,
    zip = "11218",
    street = "10 Dress St",
    recipientName = "P12 Dress",
    feeCents = 500,
    draftPrefix = "p12-dress",
  } = opts;
  const season = await db.season.findFirst({ where: { status: "OPEN" } });
  const customer = await db.customer.findFirst({
    where: { email: "customer@tomchei.local" },
  });
  const product = await db.product.findFirst({
    where: { sku: "FAMILY-BOX", seasonId: season?.id },
  });
  const method = await db.fulfillmentMethod.findUnique({ where: { code: methodCode } });
  if (!season || !customer || !product || !method) {
    throw new Error(`seed missing for ${methodCode}`);
  }

  await db.inventoryItem.upsert({
    where: { productId: product.id },
    create: { productId: product.id, onHand: 500, reserved: 0, version: 1 },
    update: { onHand: 500 },
  });

  const draftRef = `${draftPrefix}-${methodCode}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const greeting = "Happy Purim";
  const addr = {
    recipientName,
    addressLine1: street,
    city: "Brooklyn",
    state: "NY",
    postalCode: zip,
    country: "US",
  };
  const order = await db.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      status: OrderStatus.DRAFT,
      draftRef,
      greetingDefault: greeting,
      donationCents: 0,
      fulfillmentFeeCents: feeCents,
      paymentStatusCached: CachedPaymentStatus.UNPAID,
      expectedTotalCents: product.basePriceCents + feeCents,
      checkoutSnapshot: { scaleFixture: "p12", dress: true },
      lines: {
        create: {
          productId: product.id,
          quantity: 1,
          unitPriceCents: product.basePriceCents,
          ...addr,
          fulfillmentMethodId: method.id,
          greeting,
          groupingKey: buildGroupingKey({
            ...addr,
            fulfillmentMethodCode: methodCode,
            greeting,
          }),
        },
      },
    },
  });

  const finalized = await finalizeOrder(order.id);
  if (!finalized.ok) {
    throw new Error(`finalize failed: ${finalized.publicMessage || finalized.error}`);
  }

  await db.payment.create({
    data: {
      orderId: order.id,
      method: PaymentMethod.CASH,
      state: PaymentState.POSTED,
      amountCents: product.basePriceCents + feeCents,
    },
  });
  await db.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.PAID,
      paymentStatusCached: CachedPaymentStatus.PAID,
    },
  });

  const pkg = await db.package.findFirst({ where: { orderId: order.id } });
  if (!pkg) throw new Error("no package");
  return { order, pkg, season, product, feeCents, customer };
}

async function main() {
  await db.$connect();
  const manager = await db.staffUser.findFirst({
    where: { email: "manager@tomchei.local" },
  });
  if (!manager) throw new Error("manager missing — run db:seed");

  // --- Seed ledger for S1: multi-season + margin labels ---
  const shipA = await ensurePaidOrder({
    methodCode: "SHIP",
    street: "11 Margin Ave",
    recipientName: "Margin A",
  });
  const shipB = await ensurePaidOrder({
    methodCode: "SHIP",
    street: "22 Margin Ave",
    recipientName: "Margin B",
  });
  const labelA = await createLabelForPackage({
    packageId: shipA.pkg.id,
    actorId: manager.id,
    seasonId: shipA.season.id,
  });
  const labelB = await createLabelForPackage({
    packageId: shipB.pkg.id,
    actorId: manager.id,
    seasonId: shipB.season.id,
  });

  const expectedCharged = labelA.margin.chargedCents + labelB.margin.chargedCents;
  const expectedPurchased = labelA.margin.purchasedCents + labelB.margin.purchasedCents;
  const expectedMargin = labelA.margin.marginCents + labelB.margin.marginCents;

  const perf = await performanceReport();
  const openPerf = perf.find((s) => s.seasonId === shipA.season.id);
  const margin = await marginReport({ seasonId: shipA.season.id });

  const reportsApi = await req("/api/admin/reports?kind=performance", {
    headers: cookieHeader(),
  });
  const marginApi = await req("/api/admin/reports?kind=margin", {
    headers: cookieHeader(),
  });

  const s1Ok =
    Boolean(openPerf) &&
    openPerf.paidOrderCount >= 2 &&
    margin.chargedCents >= expectedCharged &&
    margin.purchasedCents >= expectedPurchased &&
    margin.marginCents >= expectedMargin &&
    reportsApi.status === 200 &&
    marginApi.status === 200 &&
    marginApi.json?.report?.marginCents >= expectedMargin;

  push("S1", "Reports + margin", Boolean(s1Ok), {
    seasonOrders: openPerf?.orderCount,
    paidOrders: openPerf?.paidOrderCount,
    marginTotals: {
      chargedCents: margin.chargedCents,
      purchasedCents: margin.purchasedCents,
      marginCents: margin.marginCents,
    },
    seededLabels: {
      charged: expectedCharged,
      purchased: expectedPurchased,
      margin: expectedMargin,
    },
    pages: { perf: reportsApi.status, margin: marginApi.status },
  });

  // --- S2: Exports + reconciliation ---
  const exportOk = await runCsvExport({
    dataset: ExportDataset.SHIPPING_MARGIN,
    seasonId: shipA.season.id,
    staffId: manager.id,
  });
  const yearExport = await runCsvExport({
    dataset: ExportDataset.YEAR_METRICS,
    staffId: manager.id,
  });
  const unauthorized = await req("/api/admin/exports", {
    method: "POST",
    headers: {
      ...cookieHeader("dev_driver_1"),
      "content-type": "application/json",
    },
    body: JSON.stringify({ dataset: "YEAR_METRICS" }),
  });
  const authorized = await req("/api/admin/exports", {
    method: "POST",
    headers: {
      ...cookieHeader(),
      "content-type": "application/json",
    },
    body: JSON.stringify({ dataset: "ITEM_SALES", seasonId: shipA.season.id }),
  });

  // Orphan PaymentIntent on unpaid draft-like paid-status gap
  const orphanOrder = await ensurePaidOrder({
    methodCode: "PICKUP",
    street: "99 Orphan Rd",
    recipientName: "Orphan Host",
    draftPrefix: "p12-wipe",
  });
  // Strip payments so PI looks orphaned
  await db.payment.deleteMany({ where: { orderId: orphanOrder.order.id } });
  await db.order.update({
    where: { id: orphanOrder.order.id },
    data: {
      paymentStatusCached: CachedPaymentStatus.UNPAID,
      status: OrderStatus.PLACED,
    },
  });
  const orphanPiId = `pi_orphan_p12_${Date.now()}`;
  await db.stripePaymentIntent.create({
    data: {
      orderId: orphanOrder.order.id,
      stripePaymentIntentId: orphanPiId,
      status: "succeeded",
      amountCents: 5400,
      currency: "usd",
    },
  });

  const recon1 = await runPaymentReconcile({
    triggeredBy: "manual",
    staffId: manager.id,
  });
  const recon2 = await runPaymentReconcile({
    triggeredBy: "manual",
    staffId: manager.id,
  });
  const cronRecon = await req("/api/cron/payment-reconcile", {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const cronNoAuth = await req("/api/cron/payment-reconcile", { method: "POST" });

  const s2Ok =
    exportOk.ok &&
    yearExport.ok &&
    exportOk.value.csv.includes("chargedCents") &&
    unauthorized.status === 403 &&
    authorized.status === 200 &&
    authorized.text.includes("sku") &&
    recon1.ok &&
    recon1.value.orphanedCount >= 1 &&
    recon1.value.orphans.some((o) => o.stripePaymentIntentId === orphanPiId) &&
    recon2.ok &&
    recon2.value.createdAdjustments === 0 &&
    recon2.value.skippedDuplicates >= 1 &&
    cronRecon.status === 200 &&
    (cronNoAuth.status === 401 || cronNoAuth.status === 403);

  push("S2", "Exports + reconciliation", Boolean(s2Ok), {
    exportRows: exportOk.ok ? exportOk.value.rowCount : null,
    unauthorized: unauthorized.status,
    authorized: authorized.status,
    orphanFlagged: recon1.ok
      ? recon1.value.orphans.some((o) => o.stripePaymentIntentId === orphanPiId)
      : false,
    recon1: recon1.ok
      ? {
          orphaned: recon1.value.orphanedCount,
          created: recon1.value.createdAdjustments,
        }
      : recon1.publicMessage,
    recon2: recon2.ok
      ? {
          created: recon2.value.createdAdjustments,
          skipped: recon2.value.skippedDuplicates,
        }
      : recon2.publicMessage,
    cron: { ok: cronRecon.status, noAuth: cronNoAuth.status },
  });

  // --- S3: Legacy import dry-run + resume + address cleanup ---
  // Wipe prior P12 import customers/orders so dry-run sees VALID rows (not polluted DUPLICATE).
  await setTestMode({ enabled: true, env: "test", staffId: manager.id });
  await wipeTestFixtures({ staffId: manager.id });

  const stamp = Date.now().toString(36);
  const goodEmail = `p12.good.${stamp}@tomchei.local`;
  const softEmail = `p12.soft.${stamp}@tomchei.local`;
  const soft2Email = `p12.soft2.${stamp}@tomchei.local`;
  const phoneA = `555${String(Date.now()).slice(-7)}`.slice(0, 10);
  const phoneB = `556${String(Date.now()).slice(-7)}`.slice(0, 10);
  const phoneC = `557${String(Date.now()).slice(-7)}`.slice(0, 10);
  const messyCsv = [
    "displayName,email,phone",
    `P12 Good,${goodEmail},${phoneA}`,
    "P12 Dup,customer@tomchei.local,5559990000",
    "P12 Bad,,not-a-phone",
    `P12 Soft,${softEmail},${phoneB}`,
    `P12 Soft2,${soft2Email},${phoneC}`,
  ].join("\n");

  const dry = await stageImport({
    kind: ImportKind.CUSTOMERS,
    csvText: messyCsv,
    filename: "messy-p12.csv",
    staffId: manager.id,
    dryRun: true,
  });
  if (!dry.ok) throw new Error(dry.publicMessage);
  const dryCommit = await commitImport({
    batchId: dry.value.batchId,
    staffId: manager.id,
  });

  const live = await stageImport({
    kind: ImportKind.CUSTOMERS,
    csvText: messyCsv,
    filename: "messy-p12-live.csv",
    staffId: manager.id,
    dryRun: false,
  });
  if (!live.ok) throw new Error(live.publicMessage);
  const chunk1 = await commitImport({
    batchId: live.value.batchId,
    staffId: manager.id,
    maxRows: 1,
  });
  const mid = await getImportBatch(live.value.batchId);
  const chunk2 = await commitImport({
    batchId: live.value.batchId,
    staffId: manager.id,
  });
  const after = await getImportBatch(live.value.batchId);
  const goodExists = await db.customer.findFirst({
    where: { email: goodEmail },
  });

  // Address cleanup: create duplicate-ish address + flag
  const cust = await db.customer.findFirst({
    where: { email: "customer@tomchei.local" },
  });
  await db.savedAddress.upsert({
    where: {
      customerId_addressNorm: {
        customerId: cust.id,
        addressNorm: "cleanup-dup|bad|norm",
      },
    },
    create: {
      customerId: cust.id,
      recipientName: "Cleanup Dup",
      line1: "1 Bad",
      city: "X",
      state: "NY",
      postalCode: "00000",
      country: "US",
      addressNorm: "cleanup-dup|bad|norm",
      needsReview: false,
    },
    update: {
      recipientName: "Cleanup Dup",
      line1: "1 Bad",
      city: "X",
      postalCode: "00000",
      needsReview: false,
      reviewReason: null,
      mergedIntoId: null,
    },
  });
  const cleanup = await runAddressCleanup({ staffId: manager.id, customerId: cust.id });

  const s3Ok =
    dry.ok &&
    dry.value.summary.invalid >= 1 &&
    dry.value.summary.duplicate >= 1 &&
    dry.value.summary.valid >= 1 &&
    dryCommit.ok &&
    dryCommit.value.dryRun === true &&
    chunk1.ok &&
    chunk1.value.interrupted === true &&
    mid?.status === "INTERRUPTED" &&
    chunk2.ok &&
    after?.status === "COMMITTED" &&
    Boolean(goodExists) &&
    cleanup.ok;

  push("S3", "Legacy import", Boolean(s3Ok), {
    drySummary: dry.value.summary,
    dryCommitted: dryCommit.ok ? dryCommit.value.committed : null,
    interrupted: chunk1.ok ? chunk1.value.interrupted : null,
    resumed: after?.status,
    goodCustomer: Boolean(goodExists),
    cleanup: cleanup.ok
      ? { flagged: cleanup.value.flagged, queue: cleanup.value.reviewed.length }
      : cleanup.publicMessage,
  });

  // --- S4: Imported prior-year → P10 review ---
  const imported = await seedImportedPriorYearOrder({
    customerEmail: "customer@tomchei.local",
    actorId: manager.id,
  });
  if (!imported.ok) throw new Error(imported.publicMessage);
  const preview = await previewRepeatOrder({ sourceOrderId: imported.value.orderId });
  if (!preview.ok) throw new Error(preview.publicMessage);
  const line = preview.value.lines[0];
  const confirmed = await confirmRepeatOrder({
    sourceOrderId: imported.value.orderId,
    choices: [
      {
        sourceLineId: line.sourceLineId,
        action: "map",
        toProductId: imported.value.targetProductId,
        keepRecipient: true,
        savedAddressId: imported.value.savedAddressId,
      },
    ],
    actorCustomerId: cust.id,
  });
  const reviewPage = await req(`/admin/orders/${imported.value.orderId}/repeat`, {
    headers: cookieHeader(),
  });
  const accountReview = await req(
    `/account/orders/${imported.value.orderId}/repeat`,
    { headers: cookieHeader("dev_customer_1") },
  );

  const s4Ok =
    confirmed.ok &&
    reviewPage.status === 200 &&
    (accountReview.status === 200 || accountReview.json?.ok) &&
    Boolean(preview.value.lines.length);

  push("S4", "Imported repeat", Boolean(s4Ok), {
    importedOrderId: imported.value.orderId,
    draftRef: confirmed.ok ? confirmed.value.draftRef : null,
    reviewPage: reviewPage.status,
    accountReview: accountReview.status,
  });

  // --- S5: Dress rehearsal (UI path) + scale probe (1k/5k) + wipe/reseed ---
  const { runDressRehearsal } = await import("../src/lib/ops/test-console");
  const { scalePrintProbe } = await import("../src/lib/ops/test-ops");

  await setTestMode({ enabled: true, env: "test", staffId: manager.id });
  const modeOn = await getTestMode();

  const dress = await runDressRehearsal({ staffId: manager.id });
  if (!dress.ok) throw new Error(`dressRehearsal: ${dress.publicMessage}`);

  const dressStillThere = await db.order.count({
    where: {
      OR: [
        { checkoutSnapshot: { path: ["dressRehearsal"], equals: true } },
        { id: dress.value.orderId },
      ],
    },
  });

  const probe = await scalePrintProbe({ staffId: manager.id });
  const wipe = await wipeTestFixtures({ staffId: manager.id });
  const dressAfterWipe = await db.order.count({
    where: {
      OR: [
        { checkoutSnapshot: { path: ["dressRehearsal"], equals: true } },
        { checkoutSnapshot: { path: ["p12Fixture"], equals: true } },
        { id: dress.value.orderId },
      ],
    },
  });
  const scaleAfterWipe = await db.order.count({
    where: {
      OR: [
        { checkoutSnapshot: { path: ["scaleFixture"], equals: "p6" } },
        { checkoutSnapshot: { path: ["scaleFixture"], equals: "p12" } },
      ],
    },
  });
  const reseed = await reseedTestSeason({ staffId: manager.id });

  const bannerPage = await req("/admin/test-ops", { headers: cookieHeader() });
  const helpPage = await req("/admin/help", { headers: cookieHeader() });
  const reportsPage = await req("/admin/reports", { headers: cookieHeader() });
  const vercelCrons = [
    "/api/cron/season-auto-flip",
    "/api/cron/pickup-expiry",
    "/api/cron/payment-reminder",
    "/api/cron/outbox-sweep",
    "/api/cron/purge-email-log",
    "/api/cron/payment-reconcile",
  ];
  const cronAuth = [];
  for (const p of vercelCrons) {
    const noAuth = await req(p, { method: "POST" });
    cronAuth.push(noAuth.status);
  }

  const s5Ok =
    dress.ok &&
    dressStillThere >= 1 &&
    probe.ok &&
    probe.value.scaleOrders >= 1000 &&
    probe.value.scalePackages >= 5000 &&
    probe.value.newPackagesProcessed >= 250 &&
    probe.value.acceptable === true &&
    modeOn.enabled === true &&
    wipe.ok &&
    wipe.value.deletedOrders >= 1 &&
    dressAfterWipe === 0 &&
    scaleAfterWipe === 0 &&
    reseed.ok &&
    bannerPage.status === 200 &&
    helpPage.status === 200 &&
    reportsPage.status === 200 &&
    cronAuth.every((s) => s === 401 || s === 403);

  push("S5", "Dress rehearsal", Boolean(s5Ok), {
    dress: dress.ok
      ? {
          orderId: dress.value.orderId,
          printBatchId: dress.value.printBatchId,
          marginCents: dress.value.marginCents,
        }
      : dress.publicMessage,
    dressBeforeWipe: dressStillThere,
    dressAfterWipe,
    scaleAfterWipe,
    probe: probe.ok
      ? {
          scaleOrders: probe.value.scaleOrders,
          scalePackages: probe.value.scalePackages,
          newPackagesProcessed: probe.value.newPackagesProcessed,
          nightlyMs: probe.value.elapsedMs,
          acceptable: probe.value.acceptable,
        }
      : probe.publicMessage,
    wipe: wipe.ok ? wipe.value : wipe.publicMessage,
    reseed: reseed.ok ? reseed.value : reseed.publicMessage,
    pages: {
      testOps: bannerPage.status,
      help: helpPage.status,
      reports: reportsPage.status,
    },
    cronUnauthorized: cronAuth,
  });

  await setTestMode({ enabled: false, env: "live", staffId: manager.id });

  const passed = evidence.filter((e) => e.pass).length;
  const failed = evidence.length - passed;

  const md = [
    "# PHASE-P12-SMOKE",
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
  ].join("\n");

  const status = [
    "# PHASE-P12-STATUS — arm-03",
    "",
    "**Phase:** P12 — Reporting, migration, scale hardening, launch readiness",
    `**Result:** ${failed === 0 ? "PASS" : "FAIL"}`,
    `**Smoke:** ${passed}/${evidence.length} (\`arms/arm-03/workspace/.scratch/PHASE-P12-SMOKE.md\`)`,
    "**Ports:** web 3103 / db 4103",
    "",
    "## Delivered",
    "",
    "1. Multi-season performance + shipping-margin reports",
    "2. CSV export center + audit + Stripe reconcile (manual + cron)",
    "3. Legacy import dry-run / resume / ORDERS + address cleanup",
    "4. Test console + test-mode banner + help/entity map",
    "5. Dress rehearsal E2E + nightly scale timing + wipe/reseed",
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
  await writeFile(path.join(scratchDir, "PHASE-P12-SMOKE.md"), md, "utf8");
  await writeFile(path.join(scratchDir, "PHASE-P12-STATUS.md"), status, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P12-SMOKE.md"), md, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P12-STATUS.md"), status, "utf8");
  const json = JSON.stringify(
    { phase: "P12", ok: failed === 0, passed, failed, total: evidence.length, evidence },
    null,
    2,
  );
  await writeFile(path.join(scratchDir, "PHASE-P12-SMOKE.json"), json, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P12-SMOKE.json"), json, "utf8");

  console.log(JSON.stringify({ ok: failed === 0, passed, failed, total: evidence.length }, null, 2));
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
