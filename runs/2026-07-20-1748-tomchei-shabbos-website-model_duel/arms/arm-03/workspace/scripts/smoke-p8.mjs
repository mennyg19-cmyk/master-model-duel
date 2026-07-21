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
} from "@prisma/client";
import { finalizeOrder } from "../src/lib/orders/finalize";
import { buildGroupingKey } from "../src/lib/orders/grouping";
import { selectMargin } from "../src/lib/shipping/margin";
import { mockGroundRates } from "../src/lib/shippo/client";
import { stubAssignLabelToRoute } from "../src/lib/shipping/labels";

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

async function ensurePaidShipOrder(zip) {
  const season = await db.season.findFirst({ where: { status: "OPEN" } });
  const customer = await db.customer.findFirst({ where: { email: { contains: "@" } } });
  const product = await db.product.findFirst({ where: { sku: "FAMILY-BOX" } });
  const ship = await db.fulfillmentMethod.findUnique({ where: { code: "SHIP" } });
  if (!season || !customer || !product || !ship) throw new Error("seed missing");

  await db.inventoryItem.upsert({
    where: { productId: product.id },
    create: { productId: product.id, onHand: 500, reserved: 0, version: 1 },
    update: { onHand: 500 },
  });

  const draftRef = `p8-${zip}-${Date.now().toString(36)}`;
  const greeting = "Happy Purim";
  const addr = {
    recipientName: "Ship Smoke",
    addressLine1: "10 Smoke St",
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
      paymentStatusCached: CachedPaymentStatus.UNPAID,
      lines: {
        create: {
          productId: product.id,
          quantity: 1,
          unitPriceCents: product.basePriceCents,
          ...addr,
          fulfillmentMethodId: ship.id,
          greeting,
          groupingKey: buildGroupingKey({
            ...addr,
            fulfillmentMethodCode: "SHIP",
            greeting,
          }),
        },
      },
    },
    include: { lines: true },
  });

  const quotes = mockGroundRates({
    name: addr.recipientName,
    street1: addr.addressLine1,
    city: addr.city,
    state: addr.state,
    zip,
    country: "US",
  });
  const margin = selectMargin(quotes);
  const total = product.basePriceCents + margin.chargedCents;

  await db.order.update({
    where: { id: order.id },
    data: {
      expectedTotalCents: total,
      fulfillmentFeeCents: margin.chargedCents,
      checkoutSnapshot: {
        fees: { shipFeeCents: margin.chargedCents, totalFeeCents: margin.chargedCents },
        liveShip: true,
        shipQuotes: [
          {
            chargedCents: margin.chargedCents,
            purchasedCents: margin.purchasedCents,
            marginCents: margin.marginCents,
          },
        ],
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
      amountCents: total,
    },
  });
  await db.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.PAID,
      paymentStatusCached: CachedPaymentStatus.PAID,
    },
  });

  const pkg = await db.package.findFirst({
    where: { orderId: order.id, fulfillmentMethod: { code: "SHIP" } },
  });
  if (!pkg) throw new Error("no ship package");
  return { order, pkg, margin, quotes };
}

async function main() {
  process.env.SHIPPO_MODE = process.env.SHIPPO_MODE || "mock";

  // --- S1: Margin math ---
  const even = await ensurePaidShipOrder("11218"); // even → UPS cheaper
  const odd = await ensurePaidShipOrder("11219"); // odd → FedEx cheaper

  const createEven = await req(`/api/admin/packages/${even.pkg.id}/label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ action: "create" }),
  });
  const createOdd = await req(`/api/admin/packages/${odd.pkg.id}/label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ action: "create" }),
  });

  const labelEven = createEven.json?.label;
  const labelOdd = createOdd.json?.label;
  const s1 =
    createEven.status === 200 &&
    createOdd.status === 200 &&
    labelEven?.chargedCents === even.margin.chargedCents &&
    labelEven?.purchasedCents === even.margin.purchasedCents &&
    labelEven?.marginCents === even.margin.marginCents &&
    labelEven?.chargedCents === Math.max(...even.margin.eligible.map((r) => r.amountCents)) &&
    labelEven?.purchasedCents === Math.min(...even.margin.eligible.map((r) => r.amountCents)) &&
    labelOdd?.chargedCents === odd.margin.chargedCents &&
    labelOdd?.purchasedCents === odd.margin.purchasedCents &&
    labelEven?.carrier !== labelEven?.quotesJson?.chargeRate?.carrier
      ? labelEven.purchasedCents < labelEven.chargedCents || labelEven.marginCents === 0
      : true;

  // Prefer exact margin equality as the pass gate
  const s1Pass =
    createEven.json?.ok &&
    createOdd.json?.ok &&
    labelEven?.chargedCents === 1800 &&
    labelEven?.purchasedCents === 1200 &&
    labelEven?.marginCents === 600 &&
    labelOdd?.chargedCents === 1800 &&
    labelOdd?.purchasedCents === 1200 &&
    labelOdd?.marginCents === 600 &&
    even.pkg.shipmentPlan == null
      ? true
      : createEven.json?.ok &&
        labelEven?.marginCents === labelEven?.chargedCents - labelEven?.purchasedCents &&
        labelEven?.chargedCents > labelEven?.purchasedCents;

  // Re-read package for plan
  const evenPkg = await db.package.findUnique({ where: { id: even.pkg.id } });
  const s1Final =
    Boolean(createEven.json?.ok) &&
    Boolean(createOdd.json?.ok) &&
    labelEven?.chargedCents === 1800 &&
    labelEven?.purchasedCents === 1200 &&
    labelEven?.marginCents === 600 &&
    labelOdd?.chargedCents === 1800 &&
    labelOdd?.purchasedCents === 1200 &&
    labelOdd?.marginCents === 600 &&
    Boolean(evenPkg?.shipmentPlan);

  push("S1", "Margin math: charge highest, buy cheaper, stored margin exact", s1Final, {
    even: {
      chargedCents: labelEven?.chargedCents,
      purchasedCents: labelEven?.purchasedCents,
      marginCents: labelEven?.marginCents,
      buyCarrier: labelEven?.carrier,
      planBoxes: evenPkg?.shipmentPlan?.boxes?.length,
    },
    odd: {
      chargedCents: labelOdd?.chargedCents,
      purchasedCents: labelOdd?.purchasedCents,
      marginCents: labelOdd?.marginCents,
      buyCarrier: labelOdd?.carrier,
    },
    createEvenStatus: createEven.status,
    createOddStatus: createOdd.status,
    createEvenError: createEven.json?.error,
  });

  // --- S2: Void + rebuy + live checkout rates ---
  const voidRes = await req(`/api/admin/packages/${even.pkg.id}/label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ action: "void" }),
  });
  const rebuy = await req(`/api/admin/packages/${even.pkg.id}/label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ action: "create" }),
  });

  // Live checkout prepare with SHIP
  const products = await db.product.findMany({
    where: { sku: { in: ["FAMILY-BOX"] }, isActive: true },
  });
  const family = products[0];
  const customer = await db.customer.findFirst();
  await db.order.updateMany({
    where: { customerId: customer.id, status: OrderStatus.DRAFT },
    data: { status: OrderStatus.DISCARDED, discardedAt: new Date() },
  });
  const draftCreate = await req("/api/drafts", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({}),
  });
  const draftRef = draftCreate.json?.draft?.draftRef;
  const draft = await db.order.findUnique({ where: { draftRef }, include: { lines: true } });
  // Assign via drafts API if available — fall back to direct DB for reliability
  const shipMethod = await db.fulfillmentMethod.findUnique({ where: { code: "SHIP" } });
  let lineId = draft?.lines?.[0]?.id;
  if (!lineId && draft) {
    const line = await db.orderLine.create({
      data: {
        orderId: draft.id,
        productId: family.id,
        quantity: 1,
        unitPriceCents: family.basePriceCents,
        recipientName: "Live Rate",
        addressLine1: "22 Rate Ave",
        city: "Brooklyn",
        state: "NY",
        postalCode: "11218",
        country: "US",
      },
    });
    lineId = line.id;
  } else if (lineId) {
    await db.orderLine.update({
      where: { id: lineId },
      data: {
        recipientName: "Live Rate",
        addressLine1: "22 Rate Ave",
        city: "Brooklyn",
        state: "NY",
        postalCode: "11218",
        country: "US",
        productId: family.id,
        unitPriceCents: family.basePriceCents,
      },
    });
  }

  const prep = await req("/api/checkout?action=prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      draftRef,
      recipients: [{ lineIds: [lineId], fulfillmentMethodCode: "SHIP" }],
    }),
  });

  const liveOk =
    prep.json?.summary?.liveShip === true &&
    prep.json?.summary?.fees?.shipFeeCents === 1800 &&
    Array.isArray(prep.json?.summary?.shipQuotes) &&
    prep.json.summary.shipQuotes[0]?.chargedCents === 1800 &&
    prep.json.summary.shipQuotes[0]?.purchasedCents === 1200;

  const voided = await db.shippingLabel.findFirst({
    where: {
      packageId: even.pkg.id,
      status: ShippingLabelStatus.VOIDED,
    },
  });
  const s2Pass = Boolean(voidRes.json?.ok && rebuy.json?.ok && voided && liveOk);
  push("S2", "Void + rebuy; checkout live Shippo quotes", s2Pass, {
    voidOk: voidRes.json?.ok,
    voidStatus: voidRes.status,
    voidError: voidRes.json?.error,
    rebuyOk: rebuy.json?.ok,
    rebuyError: rebuy.json?.error,
    liveShip: prep.json?.summary?.liveShip,
    shipFeeCents: prep.json?.summary?.fees?.shipFeeCents,
    shipQuotes: prep.json?.summary?.shipQuotes,
    prepStatus: prep.status,
    prepError: prep.json?.error || prep.json?.conflicts,
    createEvenStatus: createEven.status,
    createEvenError: createEven.json?.error,
  });

  // --- S3: Unshipped label guard ---
  const s3order = await ensurePaidShipOrder("11220");
  const createS3 = await req(`/api/admin/packages/${s3order.pkg.id}/label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ action: "create" }),
  });
  await db.package.update({
    where: { id: s3order.pkg.id },
    data: { stage: PackageStage.PRINTED },
  });
  const voidPrinted = await req(`/api/admin/packages/${s3order.pkg.id}/label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ action: "void" }),
  });

  const s3b = await ensurePaidShipOrder("11222");
  const createS3b = await req(`/api/admin/packages/${s3b.pkg.id}/label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ action: "create" }),
  });
  await stubAssignLabelToRoute(createS3b.json.label.id);
  const voidRouted = await req(`/api/admin/packages/${s3b.pkg.id}/label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({ action: "void" }),
  });

  const s3Pass =
    Boolean(createS3.json?.ok) &&
    Boolean(voidPrinted.json?.ok) &&
    Boolean(createS3b.json?.ok) &&
    voidRouted.status === 409 &&
    String(voidRouted.json?.error || "").toLowerCase().includes("route");

  push("S3", "Printed-but-unshipped voidable; route-assigned blocked (P9 stub)", s3Pass, {
    voidPrintedOk: voidPrinted.json?.ok,
    voidRoutedStatus: voidRouted.status,
    voidRoutedError: voidRouted.json?.error,
  });

  const passed = evidence.filter((e) => e.pass).length;
  const failed = evidence.length - passed;
  const outDir = path.join(process.cwd(), ".scratch");
  await mkdir(outDir, { recursive: true });
  const md = [
    "# PHASE-P8-SMOKE",
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
  await writeFile(path.join(outDir, "PHASE-P8-SMOKE.md"), md, "utf8");
  await writeFile(path.join(outDir, "PHASE-P8-SMOKE.json"), JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({ ok: failed === 0, passed, failed, evidence }, null, 2));
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
