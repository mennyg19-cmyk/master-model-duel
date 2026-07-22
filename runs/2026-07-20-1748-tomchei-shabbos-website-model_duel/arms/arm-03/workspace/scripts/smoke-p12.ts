/**
 * P12 smoke — S1..S5 against reports, exports, reconciliation, legacy import,
 * scale dress rehearsal, and wipe/reseed.
 *
 * Evidence: `.scratch/PHASE-P12-SMOKE.md` + JSON summary on stdout.
 */
import { createHmac, randomBytes } from "node:crypto";
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
process.env.TEST_MODE = "true";
process.env.IS_TEST_ENV = "true";
process.env.STRIPE_MODE = "mock";
process.env.SHIPPO_MODE = "mock";

type Evidence = { id: string; check: string; pass: boolean; [key: string]: unknown };

async function main() {
  const { db } = await import("../lib/db");
  const { env } = await import("../lib/env");
  const { hashPassword } = await import("../lib/auth/passwords");
  const { seasonPerformance, seasonDrilldown, marginReport } = await import("../lib/reports");
  const { exportCsv, EXPORT_DATASETS } = await import("../lib/exports");
  const { runPaymentReconciliation } = await import("../lib/payments/reconcile");
  const { planLegacyImport, legacyFileHash } = await import("../lib/legacy-import/plan");
  const { commitLegacyImport } = await import("../lib/legacy-import/commit");
  const { loadRepeatableOrder, buildRepeatPlan } = await import("../lib/repeat");
  const { newDraftReference } = await import("../lib/domain/draft-reference");
  const { finalizeOrder } = await import("../lib/domain/finalize");
  const { postPayment } = await import("../lib/payments/post-payment");
  const { runNightlyBatch } = await import("../lib/print/batches");
  const { buyLabelForPackage } = await import("../lib/shipping/labels");
  const { advancePackageStage } = await import("../lib/packages/actions");
  const { buildRoute, startRoute, markStopDelivered, switchPackageMethod } = await import(
    "../lib/routes/service"
  );
  const { wipeOpenSeason, seedDemoOrder } = await import("../lib/test-console");
  const { isTestMode } = await import("../lib/test-mode");
  const { destinationKey } = await import("../lib/checkout/recipients");

  const BASE = process.env.APP_URL ?? "http://127.0.0.1:3103";
  const CRON = env.CRON_SECRET ?? process.env.CRON_SECRET ?? "";
  const evidence: Evidence[] = [];
  let failed = 0;

  function record(row: Evidence) {
    evidence.push(row);
    if (!row.pass) failed += 1;
    console.log(`${row.pass ? "PASS" : "FAIL"} ${row.id} ${row.check}`);
  }

  console.log(`P12 smoke against ${BASE} (testMode=${isTestMode()})`);

  async function ensureManager() {
    return db.staffUser.upsert({
      where: { email: "p12-manager@tomchei.local" },
      update: { status: "ACTIVE", role: "MANAGER" },
      create: {
        email: "p12-manager@tomchei.local",
        name: "P12 Manager",
        role: "MANAGER",
        passwordHash: hashPassword("p12-manager-pass"),
      },
    });
  }

  async function mintCookie(staffUserId: string) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHmac("sha256", env.SESSION_SECRET).update(token).digest("hex");
    await db.session.create({
      data: {
        tokenHash,
        staffUserId,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      },
    });
    return `tomchei_session=${token}`;
  }

  const manager = await ensureManager();
  const managerCookie = await mintCookie(manager.id);

  const staffOnly = await db.staffUser.upsert({
    where: { email: "p12-staff@tomchei.local" },
    update: { status: "ACTIVE", role: "STAFF" },
    create: {
      email: "p12-staff@tomchei.local",
      name: "P12 Staff",
      role: "STAFF",
      passwordHash: hashPassword("p12-staff-pass"),
    },
  });
  const staffCookie = await mintCookie(staffOnly.id);

  // --- S1 Reports + margin ---
  {
    const open = await db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
    if (!open) throw new Error("No open season — run db:seed first");
    const shipping = await db.fulfillmentMethod.findUniqueOrThrow({ where: { code: "shipping" } });
    const product = await db.product.findFirstOrThrow({
      where: { seasonId: open.id, slug: "classic-basket" },
    });
    const customer = await db.customer.findUniqueOrThrow({
      where: { email: "sample.customer@example.com" },
    });

    const stamp = Date.now();
    const order = await db.order.create({
      data: {
        seasonId: open.id,
        customerId: customer.id,
        draftReference: newDraftReference(),
        itemsCents: product.basePriceCents,
        totalCents: product.basePriceCents + 1800,
        feesCents: 1800,
        feeBreakdown: [
          {
            destination: destinationKey({
              line1: "12 Smoke Ship St",
              line2: null,
              city: "Lakewood",
              state: "NJ",
              zip: "08701",
            }),
            amountCents: 1800,
            quoteId: null,
          },
        ],
        lines: {
          create: {
            productId: product.id,
            unitPriceCents: product.basePriceCents,
            recipientName: `S1 Ship ${stamp}`,
            addressLine1: "12 Smoke Ship St",
            city: "Lakewood",
            state: "NJ",
            zip: "08701",
            fulfillmentMethodId: shipping.id,
            greeting: "S1 margin seed",
          },
        },
      },
    });
    await finalizeOrder(order.id, manager.id);
    await postPayment({ orderId: order.id, method: "CHECK", amountCents: order.totalCents });

    const pkg = await db.package.findFirstOrThrow({
      where: { seasonId: open.id, recipientName: `S1 Ship ${stamp}` },
    });
    const shipment = await buyLabelForPackage(open.id, pkg.id, manager.id);

    const performance = await seasonPerformance();
    const openRow = performance.find((row) => row.seasonId === open.id);
    const drill = await seasonDrilldown(open.id);
    const margin = await marginReport(500);
    const seasonMargin = margin.totals.find((row) => row.seasonName === open.name);
    const seededRow = margin.rows.find((row) => row.shipmentId === shipment.id);

    const ledgerOrders = await db.order.count({ where: { seasonId: open.id, status: "FINALIZED" } });
    const ledgerPaid = await db.order.count({
      where: { seasonId: open.id, status: "FINALIZED", paymentStatus: { in: ["PAID", "COMPED"] } },
    });

    const pass =
      Boolean(openRow) &&
      openRow!.finalizedOrders === ledgerOrders &&
      openRow!.paidOrders === ledgerPaid &&
      Boolean(seasonMargin) &&
      Boolean(seededRow) &&
      seededRow!.chargedCents === 1800 &&
      seededRow!.marginCents === seededRow!.chargedCents - seededRow!.costCents &&
      drill.methods.length > 0;

    record({
      id: "S1",
      check: "Reports + margin",
      pass,
      seasonOrders: openRow?.finalizedOrders,
      ledgerOrders,
      paidOrders: openRow?.paidOrders,
      marginTotals: seasonMargin,
      seededLabel: seededRow
        ? {
            charged: seededRow.chargedCents,
            cost: seededRow.costCents,
            margin: seededRow.marginCents,
          }
        : null,
      drillMethods: drill.methods.length,
      drillItems: drill.items.length,
    });
  }

  // --- S2 Exports + reconciliation ---
  {
    const open = await db.season.findFirstOrThrow({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
    let exportRows = 0;
    for (const dataset of Object.keys(EXPORT_DATASETS) as (keyof typeof EXPORT_DATASETS)[]) {
      for await (const line of exportCsv(dataset, open.id)) {
        void line;
        exportRows += 1;
      }
    }

    const unauthorized = await fetch(`${BASE}/api/admin/exports/year-metrics?season=${open.id}`);
    const denied = await fetch(`${BASE}/api/admin/exports/year-metrics?season=${open.id}`, {
      headers: { Cookie: staffCookie },
    });
    const authorized = await fetch(`${BASE}/api/admin/exports/item-sales?season=${open.id}`, {
      headers: { Cookie: managerCookie },
    });
    const authorizedBody = authorized.ok ? await authorized.text() : "";
    const auditCount = await db.auditLog.count({ where: { action: "export.run" } });

    const customer = await db.customer.findUniqueOrThrow({
      where: { email: "sample.customer@example.com" },
    });
    const orphanOrder = await db.order.create({
      data: {
        seasonId: open.id,
        customerId: customer.id,
        draftReference: newDraftReference(),
        status: "FINALIZED",
        orderNumber: null,
        itemsCents: 100,
        totalCents: 2500,
        paymentStatus: "UNPAID",
        finalizedAt: new Date(),
      },
    });
    // Claim a real order number so reports stay coherent.
    const bumped = await db.season.update({
      where: { id: open.id },
      data: { orderCounter: { increment: 1 } },
      select: { orderCounter: true },
    });
    await db.order.update({
      where: { id: orphanOrder.id },
      data: { orderNumber: bumped.orderCounter },
    });
    const intentId = `pi_orphan_p12_${Date.now()}`;
    await db.stripeCheckoutSession.create({
      data: {
        orderId: orphanOrder.id,
        stripeSessionId: `cs_orphan_p12_${Date.now()}`,
        status: "completed",
        amountCents: 2500,
        paymentIntentId: intentId,
      },
    });

    const recon1 = await runPaymentReconciliation();
    const orphanFlags = await db.paymentReconFlag.count({
      where: { kind: "orphaned_payment", status: "open", orderId: orphanOrder.id },
    });
    const recon2 = await runPaymentReconciliation();
    const orphanFlagsAfter = await db.paymentReconFlag.count({
      where: { kind: "orphaned_payment", status: "open", orderId: orphanOrder.id },
    });

    const cronMissing = await fetch(`${BASE}/api/cron/stripe-reconciliation`, { method: "POST" });
    const cronOk = await fetch(`${BASE}/api/cron/stripe-reconciliation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON}` },
    });

    const pass =
      exportRows > 0 &&
      unauthorized.status === 401 &&
      denied.status === 403 &&
      authorized.status === 200 &&
      authorizedBody.includes("product") &&
      auditCount > 0 &&
      orphanFlags === 1 &&
      orphanFlagsAfter === 1 &&
      recon2.newFlags === 0 &&
      cronMissing.status === 401 &&
      cronOk.status === 200;

    record({
      id: "S2",
      check: "Exports + reconciliation",
      pass,
      exportRows,
      unauthorized: unauthorized.status,
      denied: denied.status,
      authorized: authorized.status,
      auditCount,
      orphanFlagged: orphanFlags === 1,
      recon1: { findings: recon1.findings, newFlags: recon1.newFlags, byKind: recon1.byKind },
      recon2: { findings: recon2.findings, newFlags: recon2.newFlags },
      cron: { missing: cronMissing.status, ok: cronOk.status },
    });
  }

  // --- S3 Legacy import ---
  {
    const fixture = readFileSync(resolve(process.cwd(), "tests/fixtures/legacy-2025.csv"), "utf8");
    const fileHash = legacyFileHash(fixture);

    // Wipe prior import of this exact file so the smoke is rerunnable.
    const prior = await db.legacyImportRun.findUnique({ where: { fileHash } });
    if (prior) {
      await db.addressReviewItem.deleteMany({ where: { runId: prior.id } });
      await db.legacyImportStage.deleteMany({ where: { runId: prior.id } });
      await db.legacyImportRun.delete({ where: { id: prior.id } });
    }
    const legacySeason = await db.season.findUnique({ where: { name: "Legacy 2025" } });
    if (legacySeason) {
      const orderIds = (
        await db.order.findMany({ where: { seasonId: legacySeason.id }, select: { id: true } })
      ).map((row) => row.id);
      await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.orderLineAddOn.deleteMany({ where: { orderLine: { order: { seasonId: legacySeason.id } } } });
      await db.orderLineOption.deleteMany({ where: { orderLine: { order: { seasonId: legacySeason.id } } } });
      await db.orderLine.deleteMany({ where: { order: { seasonId: legacySeason.id } } });
      await db.order.deleteMany({ where: { seasonId: legacySeason.id } });
      await db.product.deleteMany({ where: { seasonId: legacySeason.id } });
      await db.season.delete({ where: { id: legacySeason.id } });
    }

    const dry = await planLegacyImport(fixture);
    if ("error" in dry) throw new Error(dry.error);

    const run = await db.legacyImportRun.create({
      data: {
        fileHash,
        fileName: "legacy-2025.csv",
        report: {
          seasonName: dry.seasonName,
          sourceTotals: dry.sourceTotals,
          invalidRows: dry.invalidRows.length,
          repairs: dry.repairs.length,
          merges: dry.merges.length,
        },
        createdByStaffId: manager.id,
      },
    });

    const interrupted = await commitLegacyImport(run.id, dry, { stopAfterStage: "customers" });
    const mid = await db.legacyImportRun.findUniqueOrThrow({ where: { id: run.id } });
    const resumed = await commitLegacyImport(run.id, dry);
    const finalRun = await db.legacyImportRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { stages: true },
    });
    const reviewQueue = await db.addressReviewItem.count({ where: { runId: run.id, status: "open" } });
    const goodCustomer = await db.customer.findUnique({ where: { email: "chaim.gold@example.com" } });
    const importedOrders = await db.order.count({
      where: { season: { name: "Legacy 2025" }, status: "FINALIZED" },
    });

    const pass =
      dry.invalidRows.length === 2 &&
      dry.customers.length === 5 &&
      dry.repairs.length === 2 &&
      interrupted.status === "COMMITTING" &&
      mid.status === "COMMITTING" &&
      resumed.status === "COMPLETED" &&
      finalRun.status === "COMPLETED" &&
      finalRun.stages.length === 4 &&
      reviewQueue >= 2 &&
      Boolean(goodCustomer) &&
      importedOrders === dry.orders.length;

    record({
      id: "S3",
      check: "Legacy import",
      pass,
      drySummary: {
        customers: dry.customers.length,
        orders: dry.orders.length,
        invalid: dry.invalidRows.length,
        repairs: dry.repairs.length,
        merges: dry.merges.length,
        reviewFlags: dry.addresses.filter((address) => address.reviewReason).length,
        sourceTotals: dry.sourceTotals,
      },
      interrupted: interrupted.status,
      resumed: resumed.status,
      stages: finalRun.stages.map((stage) => stage.stage),
      reviewQueue,
      goodCustomer: Boolean(goodCustomer),
      importedOrders,
    });
  }

  // --- S4 Imported repeat ---
  {
    const open = await db.season.findFirstOrThrow({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
    const imported = await db.order.findFirst({
      where: { season: { name: "Legacy 2025" }, status: "FINALIZED" },
      orderBy: { orderNumber: "asc" },
    });
    if (!imported) throw new Error("S4 needs S3 imported orders");

    const order = await loadRepeatableOrder(imported.id);
    if (!order) throw new Error("Imported order missing");
    const plan = await buildRepeatPlan(order, open);
    const mapped = plan.lines.filter((line) => line.mapping.kind !== "unmapped").length;

    // Customer session for the P10 review page.
    const customer = await db.customer.findUniqueOrThrow({ where: { id: order.customerId } });
    const reviewPage = await fetch(`${BASE}/account/orders/${imported.id}/repeat`, {
      redirect: "manual",
    });

    const pass =
      plan.lines.length > 0 &&
      mapped > 0 &&
      plan.targetSeasonId === open.id &&
      (reviewPage.status === 200 || reviewPage.status === 302 || reviewPage.status === 307);

    record({
      id: "S4",
      check: "Imported repeat",
      pass,
      importedOrderId: imported.id,
      orderNumber: imported.orderNumber,
      lines: plan.lines.length,
      mapped,
      mappings: plan.lines.map((line) => line.mapping.kind),
      reviewPage: reviewPage.status,
      customerEmail: customer.email,
      targetSeason: plan.targetSeasonName,
    });
  }

  // --- S5 Dress rehearsal ---
  {
    const open = await db.season.findFirstOrThrow({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
    const methods = {
      delivery: await db.fulfillmentMethod.findUniqueOrThrow({ where: { code: "local_delivery" } }),
      pickup: await db.fulfillmentMethod.findUniqueOrThrow({ where: { code: "pickup" } }),
      shipping: await db.fulfillmentMethod.findUniqueOrThrow({ where: { code: "shipping" } }),
    };
    const product = await db.product.findFirstOrThrow({
      where: { seasonId: open.id, slug: "classic-basket" },
    });
    const customer = await db.customer.findUniqueOrThrow({
      where: { email: "sample.customer@example.com" },
    });
    const stamp = Date.now();

    const order = await db.order.create({
      data: {
        seasonId: open.id,
        customerId: customer.id,
        draftReference: newDraftReference(),
        itemsCents: product.basePriceCents * 3,
        feesCents: 2200,
        totalCents: product.basePriceCents * 3 + 2200,
        feeBreakdown: [
          {
            destination: destinationKey({
              line1: "88 Dress Ship Ave",
              line2: null,
              city: "Lakewood",
              state: "NJ",
              zip: "08701",
            }),
            amountCents: 2200,
            quoteId: null,
          },
        ],
        lines: {
          create: [
            {
              productId: product.id,
              unitPriceCents: product.basePriceCents,
              recipientName: `Dress Deliver ${stamp}`,
              addressLine1: "10 Dress Delivery Ln",
              city: "Lakewood",
              state: "NJ",
              zip: "08701",
              fulfillmentMethodId: methods.delivery.id,
              greeting: "Deliver me",
            },
            {
              productId: product.id,
              unitPriceCents: product.basePriceCents,
              recipientName: `Dress Pickup ${stamp}`,
              addressLine1: "Pickup Desk",
              city: "Lakewood",
              state: "NJ",
              zip: "08701",
              fulfillmentMethodId: methods.pickup.id,
              greeting: "Pick me up",
            },
            {
              productId: product.id,
              unitPriceCents: product.basePriceCents,
              recipientName: `Dress Ship ${stamp}`,
              addressLine1: "88 Dress Ship Ave",
              city: "Lakewood",
              state: "NJ",
              zip: "08701",
              fulfillmentMethodId: methods.shipping.id,
              greeting: "Ship me",
            },
          ],
        },
      },
    });
    const finalized = await finalizeOrder(order.id, manager.id);
    await postPayment({
      orderId: order.id,
      method: "CHECK",
      amountCents: finalized.totalCents,
    });

    const shipPkg = await db.package.findFirstOrThrow({
      where: { seasonId: open.id, recipientName: `Dress Ship ${stamp}` },
    });

    const print = await runNightlyBatch(open.id, manager.id);

    const deliverPkg = await db.package.findFirstOrThrow({
      where: { seasonId: open.id, recipientName: `Dress Deliver ${stamp}` },
    });
    const pickupPkg = await db.package.findFirstOrThrow({
      where: { seasonId: open.id, recipientName: `Dress Pickup ${stamp}` },
    });

    await advancePackageStage(open.id, deliverPkg.id, "PRINTED", deliverPkg.version, manager.id);
    const deliverFresh = await db.package.findUniqueOrThrow({ where: { id: deliverPkg.id } });
    await advancePackageStage(open.id, deliverFresh.id, "PACKED", deliverFresh.version, manager.id);

    const routeBuilt = await buildRoute(
      open.id,
      { methodId: methods.delivery.id, name: `P12 dress ${stamp}`, maxStops: 5 },
      manager.id
    );
    await startRoute(open.id, routeBuilt.route.id, manager.email);
    const stop = await db.routeStop.findFirstOrThrow({
      where: { routeId: routeBuilt.route.id, packageId: deliverPkg.id },
    });
    await markStopDelivered(open.id, routeBuilt.route.id, stop.id, {
      kind: "staff",
      staffId: manager.id,
      staffEmail: manager.email,
    });

    const pickupFresh = await db.package.findUniqueOrThrow({ where: { id: pickupPkg.id } });
    await advancePackageStage(open.id, pickupFresh.id, "PACKED", pickupFresh.version, manager.id);
    const pickupPacked = await db.package.findUniqueOrThrow({ where: { id: pickupPkg.id } });
    await advancePackageStage(open.id, pickupPacked.id, "PICKED_UP", pickupPacked.version, manager.id);

    const label = await buyLabelForPackage(open.id, shipPkg.id, manager.id);
    const shipFresh = await db.package.findUniqueOrThrow({ where: { id: shipPkg.id } });
    await advancePackageStage(open.id, shipFresh.id, "SENT", shipFresh.version, manager.id);

    const stagesBeforeWipe = {
      deliver: (await db.package.findUniqueOrThrow({ where: { id: deliverPkg.id } })).stage,
      pickup: (await db.package.findUniqueOrThrow({ where: { id: pickupPkg.id } })).stage,
      ship: (await db.package.findUniqueOrThrow({ where: { id: shipPkg.id } })).stage,
    };

    // Reroute: switch a NEW shipping package (fresh) from shipping → delivery.
    // The SENT package cannot switch; create a second shipping box for reroute.
    const rerouteOrder = await db.order.create({
      data: {
        seasonId: open.id,
        customerId: customer.id,
        draftReference: newDraftReference(),
        itemsCents: product.basePriceCents,
        totalCents: product.basePriceCents,
        lines: {
          create: {
            productId: product.id,
            unitPriceCents: product.basePriceCents,
            recipientName: `Dress Reroute ${stamp}`,
            addressLine1: "99 Reroute Rd",
            city: "Lakewood",
            state: "NJ",
            zip: "08701",
            fulfillmentMethodId: methods.shipping.id,
            greeting: "Reroute me",
          },
        },
      },
    });
    await finalizeOrder(rerouteOrder.id, manager.id);
    await postPayment({
      orderId: rerouteOrder.id,
      method: "CHECK",
      amountCents: product.basePriceCents,
    });
    const reroutePkg = await db.package.findFirstOrThrow({
      where: { seasonId: open.id, recipientName: `Dress Reroute ${stamp}` },
    });
    await buyLabelForPackage(open.id, reroutePkg.id, manager.id);
    await switchPackageMethod(open.id, reroutePkg.id, methods.delivery.id, {
      id: manager.id,
      email: manager.email,
    });
    const rerouted = await db.package.findUniqueOrThrow({
      where: { id: reroutePkg.id },
      include: { fulfillmentMethod: true, shipments: true },
    });

    const margin = await marginReport(50);
    const dressMargin = margin.rows.find((row) => row.shipmentId === label.id);

    // Scale probe (1k/5k). Wipe leaves scale customers behind, so the marker
    // email alone is not enough — reseed whenever package counts are short.
    const { spawnSync } = await import("node:child_process");
    let scaleOrders = await db.order.count({
      where: { draftReference: { startsWith: "SCALE-F-" }, status: "FINALIZED" },
    });
    let scalePackages = await db.package.count({
      where: { groupingKey: { startsWith: "scale|" } },
    });
    if (scaleOrders < 1000 || scalePackages < 5000) {
      await db.customer.deleteMany({ where: { email: { endsWith: "@example.test" } } });
      const seeded = spawnSync("npx", ["tsx", "scripts/seed-scale.ts"], {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: true,
      });
      if (seeded.status !== 0) {
        console.error(seeded.stdout, seeded.stderr);
        throw new Error("seed-scale failed");
      }
      scaleOrders = await db.order.count({
        where: { draftReference: { startsWith: "SCALE-F-" }, status: "FINALIZED" },
      });
      scalePackages = await db.package.count({
        where: { groupingKey: { startsWith: "scale|" } },
      });
    }
    // Nightly is day-keyed; force a fresh runKey window by deleting today's batch if present.
    const todayKey = `nightly-${open.id}-${new Date().toISOString().slice(0, 10)}`;
    const existingBatch = await db.printBatch.findUnique({ where: { runKey: todayKey } });
    if (existingBatch) {
      await db.printArtifact.deleteMany({ where: { printBatchId: existingBatch.id } });
      await db.printBatch.delete({ where: { id: existingBatch.id } });
    }
    // Reset a chunk of scale packages to NEW so nightly has work.
    await db.package.updateMany({
      where: { groupingKey: { startsWith: "scale|" }, stage: { in: ["PRINTED", "PACKED"] } },
      data: { stage: "NEW" },
    });
    const t0 = Date.now();
    const nightly = await runNightlyBatch(open.id, manager.id);
    const nightlyMs = Date.now() - t0;
    const newProcessed = 0;
    const artifactPackages = await db.printArtifact.findMany({
      where: { printBatchId: nightly.batch.id, kind: "PACKAGE_SLIPS" },
      select: { payload: true },
    });
    let nightlyPkgCount = 0;
    for (const artifact of artifactPackages) {
      const payload = artifact.payload as { packages?: unknown[] } | null;
      nightlyPkgCount += payload?.packages?.length ?? 0;
    }

    const dressBeforeWipe = await db.order.count({
      where: { id: { in: [order.id, rerouteOrder.id] } },
    });

    const wiped = await wipeOpenSeason();
    const dressAfterWipe = await db.order.count({
      where: { id: { in: [order.id, rerouteOrder.id] } },
    });
    const scaleAfterWipe = await db.order.count({
      where: { draftReference: { startsWith: "SCALE-F-" } },
    });
    const reseeded = await seedDemoOrder();
    const openAfter = await db.season.findFirstOrThrow({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
    });
    const reseedOrders = await db.order.count({ where: { seasonId: openAfter.id } });
    const reseedPackages = await db.package.count({ where: { seasonId: openAfter.id } });

    const cronPaths = [
      "/api/cron/season-flip",
      "/api/cron/payment-reminders",
      "/api/cron/pickup-expiry",
      "/api/cron/notification-sweeper",
      "/api/cron/email-log-purge",
      "/api/cron/stripe-reconciliation",
    ];
    const cronUnauthorized: number[] = [];
    for (const path of cronPaths) {
      const res = await fetch(`${BASE}${path}`, { method: "POST" });
      cronUnauthorized.push(res.status);
    }

    const pass =
      Boolean(finalized.orderNumber) &&
      Boolean(print.batch.id) &&
      Boolean(dressMargin) &&
      dressMargin!.chargedCents === 2200 &&
      stagesBeforeWipe.deliver === "SENT" &&
      stagesBeforeWipe.pickup === "PICKED_UP" &&
      stagesBeforeWipe.ship === "SENT" &&
      rerouted.fulfillmentMethod.kind !== "SHIPPING" &&
      rerouted.shipments.some((shipment) => shipment.status === "VOIDED") &&
      scaleOrders >= 1000 &&
      scalePackages >= 5000 &&
      nightlyMs < 60_000 &&
      nightlyPkgCount > 0 &&
      dressBeforeWipe === 2 &&
      dressAfterWipe === 0 &&
      scaleAfterWipe === 0 &&
      Boolean(reseeded.orderNumber) &&
      reseedOrders >= 1 &&
      reseedPackages >= 1 &&
      isTestMode() &&
      cronUnauthorized.every((status) => status === 401);

    record({
      id: "S5",
      check: "Dress rehearsal",
      pass,
      dress: {
        orderId: order.id,
        orderNumber: finalized.orderNumber,
        printBatchId: print.batch.id,
        marginCents: dressMargin?.marginCents,
        labelId: label.id,
        rerouteMethod: rerouted.fulfillmentMethod.code,
        voidedLabels: rerouted.shipments.filter((shipment) => shipment.status === "VOIDED").length,
      },
      stagesBeforeWipe,
      scale: {
        orders: scaleOrders,
        packages: scalePackages,
        nightlyMs,
        nightlyPkgCount,
        acceptable: nightlyMs < 60_000,
      },
      wipe: wiped.counts,
      dressBeforeWipe,
      dressAfterWipe,
      scaleAfterWipe,
      reseed: {
        orderNumber: reseeded.orderNumber,
        orderCount: reseedOrders,
        packageCount: reseedPackages,
      },
      testMode: isTestMode(),
      cronUnauthorized,
      unused: newProcessed,
    });
  }

  const summary = {
    phase: "P12",
    ok: failed === 0,
    passed: evidence.length - failed,
    failed,
    total: evidence.length,
    evidence,
  };

  mkdirSync(resolve(process.cwd(), ".scratch"), { recursive: true });
  const md = [
    "# PHASE-P12-SMOKE",
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
  writeFileSync(resolve(process.cwd(), ".scratch/PHASE-P12-SMOKE.md"), md);
  writeFileSync(resolve(process.cwd(), ".scratch/PHASE-P12-SMOKE.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, total: summary.total }));
  await db.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
