import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PrismaClient,
  OrderStatus,
  PackageStage,
  CachedPaymentStatus,
  PaymentMethod,
  PaymentState,
  AuditAction,
} from "@prisma/client";
import { finalizeOrder } from "../src/lib/orders/finalize";
import { buildGroupingKey } from "../src/lib/orders/grouping";

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
  return { status: res.status, text, json, headers: res.headers };
}

function push(id, check, pass, extra = {}) {
  evidence.push({ id, check, pass, ...extra });
}

async function main() {
  const manager = process.env.DEV_MANAGER_USER_ID || "dev_manager_1";

  const season = await db.season.findFirst({ orderBy: { year: "desc" } });
  const customer = await db.customer.findFirst({
    where: { email: "customer@tomchei.local" },
  });
  const product = await db.product.findFirst({ where: { sku: "FAMILY-BOX" } });
  const ship = await db.fulfillmentMethod.findFirst({ where: { code: "SHIP" } });
  const pickup = await db.fulfillmentMethod.findFirst({ where: { code: "PICKUP" } });

  if (!season || !customer || !product || !ship || !pickup) {
    throw new Error("Missing seed fixtures for P7 smoke");
  }

  // Ensure inventory headroom
  await db.inventoryItem.upsert({
    where: { productId: product.id },
    create: { productId: product.id, onHand: 500, reserved: 0, version: 1 },
    update: { onHand: 500 },
  });

  const stamp = Date.now().toString(36);
  const r1 = {
    recipientName: "P7 Recipient Ship",
    addressLine1: "10 Ship Ave",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11218",
    country: "US",
  };
  const r2 = {
    recipientName: "P7 Recipient Pickup",
    addressLine1: "20 Pickup Rd",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11219",
    country: "US",
  };

  const draft = await db.order.create({
    data: {
      seasonId: season.id,
      customerId: customer.id,
      status: OrderStatus.DRAFT,
      draftRef: `D-2026-P7${stamp}`,
      paymentStatusCached: CachedPaymentStatus.UNPAID,
      expectedTotalCents: product.basePriceCents * 4,
      greetingDefault: "Chag Sameach",
      lines: {
        create: [
          {
            productId: product.id,
            quantity: 1,
            unitPriceCents: product.basePriceCents,
            ...r1,
            fulfillmentMethodId: ship.id,
            groupingKey: buildGroupingKey({
              ...r1,
              fulfillmentMethodCode: ship.code,
              greeting: "Chag Sameach",
            }),
            greeting: "Chag Sameach",
          },
          {
            productId: product.id,
            quantity: 1,
            unitPriceCents: product.basePriceCents,
            ...r1,
            fulfillmentMethodId: ship.id,
            groupingKey: buildGroupingKey({
              ...r1,
              fulfillmentMethodCode: ship.code,
              greeting: "Chag Sameach",
            }),
            greeting: "Chag Sameach",
          },
          {
            productId: product.id,
            quantity: 1,
            unitPriceCents: product.basePriceCents,
            ...r2,
            fulfillmentMethodId: pickup.id,
            groupingKey: buildGroupingKey({
              ...r2,
              fulfillmentMethodCode: pickup.code,
              greeting: "Happy Purim",
            }),
            greeting: "Happy Purim",
          },
          {
            productId: product.id,
            quantity: 1,
            unitPriceCents: product.basePriceCents,
            ...r2,
            fulfillmentMethodId: pickup.id,
            groupingKey: buildGroupingKey({
              ...r2,
              fulfillmentMethodCode: pickup.code,
              greeting: "Happy Purim",
            }),
            greeting: "Happy Purim",
          },
        ],
      },
    },
  });

  const finalized = await finalizeOrder(draft.id, null);
  push(
    "S1a",
    "Finalize materializes packages via grouping (2 recipients × 2 methods → 2 packages)",
    finalized.ok && finalized.value.packageCount === 2,
    {
      packageCount: finalized.ok ? finalized.value.packageCount : null,
      error: finalized.ok ? null : finalized.publicMessage,
    },
  );

  const orderId = draft.id;
  await db.payment.create({
    data: {
      orderId,
      method: PaymentMethod.CASH,
      state: PaymentState.POSTED,
      amountCents: product.basePriceCents * 4,
      reference: "p7-smoke",
    },
  });
  await db.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.PAID,
      paymentStatusCached: CachedPaymentStatus.PAID,
    },
  });

  const pkgsBefore = await db.package.findMany({
    where: { orderId },
    include: { items: true, fulfillmentMethod: true, audits: true },
    orderBy: { createdAt: "asc" },
  });
  push(
    "S1b",
    "Packages have distinct methods and item counts",
    pkgsBefore.length === 2 &&
      pkgsBefore.every((p) => p.items.length === 2) &&
      new Set(pkgsBefore.map((p) => p.fulfillmentMethod.code)).size === 2,
    {
      methods: pkgsBefore.map((p) => p.fulfillmentMethod.code),
      itemCounts: pkgsBefore.map((p) => p.items.length),
    },
  );

  const splitTarget = pkgsBefore.find((p) => p.items.length >= 2) || pkgsBefore[0];
  const splitRes = await req(`/api/admin/packages/${splitTarget.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      action: "split",
      itemIds: [splitTarget.items[0].id],
      expectedVersion: splitTarget.version,
    }),
  });
  push("S1c", "Split one package via API", splitRes.status === 200 && splitRes.json?.ok, {
    status: splitRes.status,
    body: splitRes.json,
  });

  const pkgsAfterSplit = await db.package.findMany({
    where: { orderId },
    include: { items: true, audits: true },
  });
  push(
    "S1d",
    "After split: 3 packages; audit retained on source",
    pkgsAfterSplit.length === 3 &&
      pkgsAfterSplit.some((p) =>
        p.audits.some((a) => (a.note || "").includes("Split")),
      ),
    { packageCount: pkgsAfterSplit.length },
  );

  // Print both resulting packages from the split lineage
  const printAll = await req("/api/admin/print-batches", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ action: "reprint-order", orderId }),
  });
  push(
    "S1e",
    "Split packages both included in print reprint-order",
    printAll.status === 200 &&
      printAll.json?.ok &&
      printAll.json.packageCount === 3 &&
      printAll.json.stagesUnchanged === true,
    { body: printAll.json },
  );

  const splitAudit = await db.auditLog.findFirst({
    where: {
      action: AuditAction.PACKAGE_SPLIT,
      meta: { path: ["orderId"], equals: orderId },
    },
  });
  push("S1f", "PACKAGE_SPLIT audit retained", Boolean(splitAudit), {
    auditId: splitAudit?.id,
  });

  // --- S2 Print vs status ---
  const stagesBeforePrint = await db.package.findMany({
    where: { orderId },
    select: { id: true, stage: true },
  });
  const printArtifacts = await req("/api/admin/print-batches", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ action: "reprint-order", orderId }),
  });
  const stagesAfterPrint = await db.package.findMany({
    where: { orderId },
    select: { id: true, stage: true },
  });
  const stageMapBefore = Object.fromEntries(stagesBeforePrint.map((p) => [p.id, p.stage]));
  const stagesUnchanged = stagesAfterPrint.every((p) => stageMapBefore[p.id] === p.stage);
  push(
    "S2a",
    "Print all artifacts → no stage change",
    printArtifacts.status === 200 &&
      printArtifacts.json?.stagesUnchanged === true &&
      stagesUnchanged,
    {
      stagesBefore: stageMapBefore,
      stagesAfter: Object.fromEntries(stagesAfterPrint.map((p) => [p.id, p.stage])),
    },
  );

  const artifactIds = [];
  if (printArtifacts.json?.batchId) {
    const batch = await db.printBatch.findUnique({
      where: { id: printArtifacts.json.batchId },
      include: { artifacts: true },
    });
    for (const a of batch?.artifacts || []) artifactIds.push(a.id);
  }
  let pdfOk = true;
  for (const id of artifactIds.slice(0, 4)) {
    const pdf = await req(`/api/admin/print-batches/artifacts/${id}`, {
      headers: cookieHeader(manager),
    });
    const ct = pdf.headers.get("content-type") || "";
    if (pdf.status !== 200 || !ct.includes("pdf")) pdfOk = false;
  }
  push("S2b", "Printed artifacts download as PDF", pdfOk && artifactIds.length > 0, {
    artifactCount: artifactIds.length,
  });

  // SENT is SHIP-terminal only (PICKUP → PICKED_UP).
  const shipPkg =
    (
      await db.package.findMany({
        where: { orderId },
        include: { fulfillmentMethod: true },
        orderBy: { createdAt: "asc" },
      })
    ).find((p) => p.fulfillmentMethod.code === "SHIP") || stagesAfterPrint[0];
  const targetPkg = shipPkg;
  const markPrinted = await req(`/api/admin/packages/${targetPkg.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ action: "stage", toStage: PackageStage.PRINTED }),
  });
  const afterPrinted = await db.package.findUnique({ where: { id: targetPkg.id } });
  push(
    "S2c",
    "Mark Printed separately",
    markPrinted.status === 200 && afterPrinted?.stage === PackageStage.PRINTED,
    { stage: afterPrinted?.stage },
  );

  const markPacked = await req(`/api/admin/packages/${targetPkg.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      action: "stage",
      toStage: PackageStage.PACKED,
      expectedVersion: afterPrinted.version,
    }),
  });
  const afterPacked = await db.package.findUnique({ where: { id: targetPkg.id } });
  push(
    "S2d",
    "Mark Packed separately",
    markPacked.status === 200 && afterPacked?.stage === PackageStage.PACKED,
    { stage: afterPacked?.stage },
  );

  const markSent = await req(`/api/admin/packages/${targetPkg.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      action: "stage",
      toStage: PackageStage.SENT,
      expectedVersion: afterPacked.version,
    }),
  });
  const afterSent = await db.package.findUnique({ where: { id: targetPkg.id } });
  push(
    "S2e",
    "Mark Sent separately",
    markSent.status === 200 && afterSent?.stage === PackageStage.SENT,
    { stage: afterSent?.stage },
  );

  const boardPage = await req("/admin/packages", { headers: cookieHeader(manager) });
  const fulfillPage = await req("/admin/fulfillment", { headers: cookieHeader(manager) });
  const printPage = await req("/admin/print-batches", { headers: cookieHeader(manager) });
  push(
    "S2f",
    "Staff package board + fulfillment + print pages load",
    boardPage.status === 200 &&
      boardPage.text.includes("package-board") &&
      fulfillPage.status === 200 &&
      fulfillPage.text.includes("fulfillment-dashboard") &&
      printPage.status === 200 &&
      printPage.text.includes("print-batches"),
    {
      board: boardPage.status,
      fulfill: fulfillPage.status,
      print: printPage.status,
    },
  );

  // --- S3 Batch idempotency ---
  // Unique calendar day so re-runs do not collide with prior nightly runKeys.
  const dayStamp = Date.now();
  const day = `2099-${String(1 + (dayStamp % 12)).padStart(2, "0")}-${String(1 + (Math.floor(dayStamp / 12) % 28)).padStart(2, "0")}`;
  const nightly1 = await req("/api/admin/print-batches", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ action: "nightly", seasonId: season.id, day }),
  });
  const nightly2 = await req("/api/admin/print-batches", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ action: "nightly", seasonId: season.id, day }),
  });
  push(
    "S3a",
    "Nightly batch twice → second idempotent",
    nightly1.status === 200 &&
      nightly1.json?.created === true &&
      nightly2.status === 200 &&
      nightly2.json?.created === false &&
      nightly1.json?.batchId === nightly2.json?.batchId &&
      nightly1.json?.stagesUnchanged === true,
    {
      first: {
        ok: nightly1.json?.ok,
        batchId: nightly1.json?.batchId,
        runKey: nightly1.json?.runKey,
        created: nightly1.json?.created,
        artifactCount: nightly1.json?.artifactCount,
        packageCount: nightly1.json?.packageCount,
        stagesUnchanged: nightly1.json?.stagesUnchanged,
      },
      second: {
        ok: nightly2.json?.ok,
        batchId: nightly2.json?.batchId,
        runKey: nightly2.json?.runKey,
        created: nightly2.json?.created,
        artifactCount: nightly2.json?.artifactCount,
        packageCount: nightly2.json?.packageCount,
        stagesUnchanged: nightly2.json?.stagesUnchanged,
      },
    },
  );

  const batchCountBefore = await db.printBatch.count();
  const reprintGroup = await req("/api/admin/print-batches", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({
      action: "reprint-group",
      seasonId: season.id,
      filingGroup: "PICKUP",
    }),
  });
  const reprintOrder = await req("/api/admin/print-batches", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader(manager) },
    body: JSON.stringify({ action: "reprint-order", orderId }),
  });
  const batchCountAfter = await db.printBatch.count();
  const expectedDelta =
    (reprintGroup.json?.created ? 1 : 0) + (reprintOrder.json?.created ? 1 : 0);
  push(
    "S3b",
    "Reprint one group + one order without unrelated regen of nightly",
    reprintGroup.status === 200 &&
      reprintOrder.status === 200 &&
      reprintOrder.json?.created === true &&
      batchCountAfter === batchCountBefore + expectedDelta &&
      nightly1.json?.batchId &&
      (await db.printBatch.findUnique({ where: { id: nightly1.json.batchId } })) != null,
    {
      batchCountBefore,
      batchCountAfter,
      expectedDelta,
      reprintGroup: {
        ok: reprintGroup.json?.ok,
        batchId: reprintGroup.json?.batchId,
        runKey: reprintGroup.json?.runKey,
        created: reprintGroup.json?.created,
        artifactCount: reprintGroup.json?.artifactCount,
        packageCount: reprintGroup.json?.packageCount,
        stagesUnchanged: reprintGroup.json?.stagesUnchanged,
      },
      reprintOrder: {
        ok: reprintOrder.json?.ok,
        batchId: reprintOrder.json?.batchId,
        runKey: reprintOrder.json?.runKey,
        created: reprintOrder.json?.created,
        artifactCount: reprintOrder.json?.artifactCount,
        packageCount: reprintOrder.json?.packageCount,
        stagesUnchanged: reprintOrder.json?.stagesUnchanged,
        packageStages: reprintOrder.json?.packageStages,
      },
    },
  );

  const stillUnshipped = await db.package.findMany({
    where: { orderId, stage: { not: PackageStage.SENT } },
  });
  // Target was marked SENT; others must still be unshipped after prints
  const printedUnshipped = stillUnshipped.every(
    (p) => p.stage === PackageStage.NEW || p.stage === PackageStage.PRINTED || p.stage === PackageStage.PACKED,
  );
  push(
    "S3c",
    "Printed packages still unshipped (except explicitly marked Sent)",
    printedUnshipped && stillUnshipped.length >= 2,
    {
      stages: (
        await db.package.findMany({
          where: { orderId },
          select: { id: true, stage: true },
        })
      ),
    },
  );

  const dash = await req("/api/admin/fulfillment", { headers: cookieHeader(manager) });
  push(
    "S3d",
    "Fulfillment channel dashboard returns summaries",
    dash.status === 200 && dash.json?.ok && Array.isArray(dash.json.channels),
    { channelCount: dash.json?.channels?.length },
  );

  const passed = evidence.filter((e) => e.pass).length;
  const failed = evidence.filter((e) => !e.pass).length;

  const md = [
    "# PHASE-P7-SMOKE",
    "",
    `Base: ${base}`,
    `Passed: ${passed} / ${evidence.length}`,
    `Failed: ${failed}`,
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

  const armResults = path.resolve(process.cwd(), "..", "results");
  const scratch = path.resolve(process.cwd(), ".scratch");
  await mkdir(armResults, { recursive: true });
  await mkdir(scratch, { recursive: true });
  await writeFile(path.join(armResults, "PHASE-P7-SMOKE.md"), md, "utf8");
  await writeFile(
    path.join(armResults, "PHASE-P7-SMOKE.json"),
    JSON.stringify({ passed, failed, evidence }, null, 2),
    "utf8",
  );
  await writeFile(path.join(scratch, "PHASE-P7-SMOKE.md"), md, "utf8");

  console.log(JSON.stringify({ passed, failed, evidence }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
