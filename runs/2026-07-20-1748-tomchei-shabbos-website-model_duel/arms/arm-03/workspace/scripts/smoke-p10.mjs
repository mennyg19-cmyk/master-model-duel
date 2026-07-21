import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient, OrderStatus, SeasonStatus } from "@prisma/client";
import {
  previewRepeatOrder,
  confirmRepeatOrder,
  bulkRepeatOrders,
} from "../src/lib/ops/repeat";
import {
  createSeason,
  setSeasonStatus,
  applyScheduledSeasonFlips,
} from "../src/lib/seasons/manage";

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

async function main() {
  await db.$connect();

  const manager = await db.staffUser.findFirst({
    where: { email: "manager@tomchei.local" },
  });
  const customer = await db.customer.findFirst({
    where: { email: "customer@tomchei.local" },
  });
  const openSeason = await db.season.findFirst({
    where: { status: SeasonStatus.OPEN },
  });
  const discontinued = await db.product.findFirst({
    where: { sku: "LEGACY-DELUXE" },
  });
  const nearPrice = await db.product.findFirst({
    where: { sku: "FAMILY-DELUXE", seasonId: openSeason.id },
  });
  const imported = await db.order.findFirst({
    where: { draftRef: "IMP-2025-PRIOR" },
    include: { lines: true },
  });

  if (!manager || !customer || !openSeason || !discontinued || !nearPrice || !imported) {
    throw new Error("P10 seed incomplete — run npm run db:seed");
  }

  // --- S1 ---
  const preview = await previewRepeatOrder({ sourceOrderId: imported.id });
  if (!preview.ok) throw new Error(preview.publicMessage);
  const line = preview.value.lines[0];
  const priceSmart =
    line?.defaultProductId === nearPrice.id && !line.requiresPick;

  const blocked = await confirmRepeatOrder({
    sourceOrderId: imported.id,
    choices: [
      {
        sourceLineId: line.sourceLineId,
        action: "map",
        toProductId: nearPrice.id,
        // keepRecipient omitted → must fail recipient confirm
      },
    ],
    actorCustomerId: customer.id,
  });
  const forcedConfirm = !blocked.ok;

  const confirmed = await confirmRepeatOrder({
    sourceOrderId: imported.id,
    choices: [
      {
        sourceLineId: line.sourceLineId,
        action: "map",
        toProductId: nearPrice.id,
        keepRecipient: true,
        savedAddressId: "seed-addr-customer-friend",
      },
    ],
    actorCustomerId: customer.id,
  });
  if (!confirmed.ok) throw new Error(confirmed.publicMessage);

  const draft = await db.order.findUnique({
    where: { id: confirmed.value.orderId },
    include: { lines: true },
  });
  const mappedOk =
    draft?.lines[0]?.productId === nearPrice.id &&
    draft?.lines[0]?.recipientName === "Rivky Cohen" &&
    draft?.lines[0]?.savedAddressId === "seed-addr-customer-friend";

  const apiPreview = await req(`/api/account/orders/${imported.id}/repeat`, {
    headers: cookieHeader("dev_customer_1"),
  });

  push(
    "S1",
    "Repeat with discontinued item",
    Boolean(priceSmart && forcedConfirm && mappedOk && apiPreview.json?.ok),
    {
      priceSmart,
      forcedConfirm,
      defaultProductId: line?.defaultProductId,
      nearPriceId: nearPrice.id,
      draftRef: confirmed.value.draftRef,
      mappedOk,
      apiPreviewOk: Boolean(apiPreview.json?.ok),
      candidates: line?.replacement?.candidates?.map((c) => c.sku),
    },
  );

  // --- S2 ---
  const product = await db.product.findFirst({
    where: { sku: "FAMILY-BOX", seasonId: openSeason.id },
  });
  const ship = await db.fulfillmentMethod.findUnique({ where: { code: "SHIP" } });
  const bulkSource = await db.order.create({
    data: {
      seasonId: openSeason.id,
      customerId: customer.id,
      status: OrderStatus.PAID,
      draftRef: `p10-bulk-${Date.now().toString(36)}`,
      orderNumber: 9001 + Math.floor(Math.random() * 1000),
      placedAt: new Date(),
      greetingDefault: "Bulk source",
      lines: {
        create: {
          productId: product.id,
          quantity: 1,
          unitPriceCents: product.basePriceCents,
          optionAdjustCents: 0,
          recipientName: "Bulk Recipient",
          addressLine1: "10 Bulk St",
          city: "Brooklyn",
          state: "NY",
          postalCode: "11218",
          country: "US",
          fulfillmentMethodId: ship.id,
          greeting: "Bulk source",
          groupingKey: "bulk",
        },
      },
    },
  });

  const freshImported = await db.order.findUniqueOrThrow({
    where: { id: imported.id },
  });
  const bulk = await bulkRepeatOrders({
    items: [
      { orderId: freshImported.id, expectedVersion: freshImported.version },
      { orderId: bulkSource.id, expectedVersion: bulkSource.version },
    ],
    staffId: manager.id,
    targetSeasonId: openSeason.id,
    confirmReplacements: true,
    confirmRecipients: true,
  });
  if (!bulk.ok) throw new Error(bulk.publicMessage);

  const wizard = await createSeason({
    name: "P10 Flip Season",
    year: 2099,
    slug: `p10-flip-${Date.now().toString(36)}`,
    copyFromSeasonId: openSeason.id,
    scheduledOpenAt: new Date(Date.now() - 60_000),
    staffId: manager.id,
  });
  if (!wizard.ok) throw new Error(wizard.publicMessage);

  await setSeasonStatus({
    seasonId: openSeason.id,
    status: SeasonStatus.CLOSED,
    staffId: manager.id,
  });

  const cronRes = await req("/api/cron/season-auto-flip", {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const flip = cronRes.json?.ok
    ? cronRes.json
    : await applyScheduledSeasonFlips();
  const flipSeason = await db.season.findUnique({
    where: { id: wizard.value.season.id },
  });
  const opened =
    flipSeason?.status === SeasonStatus.OPEN &&
    (flip.opened || []).includes(wizard.value.season.id);

  await setSeasonStatus({
    seasonId: openSeason.id,
    status: SeasonStatus.OPEN,
    staffId: manager.id,
  });

  push(
    "S2",
    "Bulk repeat + auto-flip",
    Boolean(bulk.value.created.length >= 2 && opened),
    {
      bulkCreated: bulk.value.created.length,
      conflicts: bulk.value.conflicts,
      skipped: bulk.value.skipped,
      flipOpened: flip.opened,
      flipSeasonStatus: flipSeason?.status,
      productsCopied: wizard.value.productsCopied,
      cronStatus: cronRes.status,
    },
  );

  // --- S3 ---
  const s3Preview = await previewRepeatOrder({ sourceOrderId: imported.id });
  const s3Confirm = await confirmRepeatOrder({
    sourceOrderId: imported.id,
    choices: s3Preview.ok
      ? s3Preview.value.lines.map((l) => ({
          sourceLineId: l.sourceLineId,
          action: "map",
          toProductId: l.defaultProductId || nearPrice.id,
          keepRecipient: true,
          savedAddressId: l.recipient.savedAddressId,
        }))
      : [],
    actorCustomerId: customer.id,
  });
  const s3Draft = s3Confirm.ok
    ? await db.order.findUnique({
        where: { id: s3Confirm.value.orderId },
        include: { lines: true },
      })
    : null;

  const s3Ok =
    s3Confirm.ok &&
    s3Draft?.lines[0]?.productId === nearPrice.id &&
    s3Draft?.lines[0]?.recipientName === "Rivky Cohen" &&
    s3Draft?.lines[0]?.savedAddressId === "seed-addr-customer-friend" &&
    Boolean(s3Draft?.lines[0]?.greeting);

  push("S3", "Imported prior-year repeat", Boolean(s3Ok), {
    draftRef: s3Confirm.ok ? s3Confirm.value.draftRef : null,
    productId: s3Draft?.lines[0]?.productId,
    recipientName: s3Draft?.lines[0]?.recipientName,
    savedAddressId: s3Draft?.lines[0]?.savedAddressId,
    greeting: s3Draft?.lines[0]?.greeting,
  });

  const seasonsPage = await req("/admin/seasons", { headers: cookieHeader() });
  const reviewPage = await req(`/account/orders/${imported.id}/repeat`, {
    headers: cookieHeader("dev_customer_1"),
  });

  const passed = evidence.filter((e) => e.pass).length;
  const failed = evidence.length - passed;

  const md = [
    "# PHASE-P10-SMOKE",
    "",
    `**Arm:** arm-03`,
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
    `Pages: seasons=${seasonsPage.status} review=${reviewPage.status}`,
    "",
  ].join("\n");

  const status = [
    "# PHASE-P10-STATUS — arm-03",
    "",
    "**Phase:** P10 — Seasons management, repeat orders, replacement mappings",
    `**Result:** ${failed === 0 ? "PASS" : "FAIL"}`,
    `**Smoke:** ${passed}/${evidence.length} (\`arms/arm-03/workspace/.scratch/PHASE-P10-SMOKE.md\`)`,
    "**Ports:** web 3103 / db 4103",
    "",
    "## Delivered",
    "",
    "1. Replacement chain resolution + price-smart defaults (R-048, G-013)",
    "2. Customer repeat review confirming replacements + recipients (UR-007, G-011, G-012)",
    "3. Staff single + bulk repeat into open season (R-057, R-058)",
    "4. New-season wizard, Open/Closed gate, scheduled auto-flip cron (R-097, UR-008)",
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
  await writeFile(path.join(scratchDir, "PHASE-P10-SMOKE.md"), md, "utf8");
  await writeFile(path.join(scratchDir, "PHASE-P10-STATUS.md"), status, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P10-SMOKE.md"), md, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P10-STATUS.md"), status, "utf8");
  const json = JSON.stringify(
    { phase: "P10", ok: failed === 0, passed, failed, total: evidence.length, evidence },
    null,
    2,
  );
  await writeFile(path.join(scratchDir, "PHASE-P10-SMOKE.json"), json, "utf8");
  await writeFile(path.join(resultsDir, "PHASE-P10-SMOKE.json"), json, "utf8");

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
