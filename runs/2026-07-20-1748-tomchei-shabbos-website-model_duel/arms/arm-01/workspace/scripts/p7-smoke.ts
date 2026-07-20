import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { finalizeOrder } from "../src/domain/order-engine";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, separator)] ??= line.slice(separator + 1);
  }
}

const prisma = new PrismaClient();
const baseUrl = "http://127.0.0.1:3101";
const authSecret = "p5-local-smoke-signing-key-2026";
const runKey = randomUUID().slice(0, 8);
const dateNumber = (Number.parseInt(runKey.slice(0, 4), 16) % 336) + 1;
const month = String(Math.floor((dateNumber - 1) / 28) + 1).padStart(2, "0");
const day = String(((dateNumber - 1) % 28) + 1).padStart(2, "0");
const nightlyDateKey = `2099-${month}-${day}`;
const hebrewRecipient = "משפחת כהן";

function authHeaders() {
  const timestamp = Date.now();
  const signature = createHmac("sha256", authSecret)
    .update(`p7_manager.${timestamp}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-test-clerk-user-id": "p7_manager",
    "x-test-auth-token": `${timestamp}.${signature}`,
  };
}

async function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
}

async function post(path: string, body: unknown) {
  const response = await request(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function run() {
  await prisma.staffUser.upsert({
    where: { email: "p7.manager@example.test" },
    update: {
      clerkUserId: "p7_manager",
      role: "MANAGER",
      status: "ACTIVE",
      denyPermissions: [],
    },
    create: {
      clerkUserId: "p7_manager",
      email: "p7.manager@example.test",
      displayName: "P7 Manager",
      role: "MANAGER",
      status: "ACTIVE",
      confirmedAt: new Date(),
    },
  });
  const seasonSetting = await prisma.appSetting.findUniqueOrThrow({
    where: { key: "current-season-id" },
  });
  const seasonId = String(seasonSetting.value);
  const product = await prisma.product.findFirstOrThrow({
    where: { seasonId, kind: "PACKAGE", isActive: true },
  });
  const methods = await prisma.fulfillmentMethod.findMany({
    where: {
      seasonId,
      code: { in: ["PICKUP", "SHIPPING"] },
      isActive: true,
    },
    orderBy: { code: "asc" },
  });
  assert.equal(methods.length, 2, "P7 smoke needs pickup and shipping methods.");
  const customer = await prisma.customer.create({
    data: {
      displayName: `P7 Customer ${runKey}`,
      email: `p7-${runKey}@example.test`,
      emailNormalized: `p7-${runKey}@example.test`,
      addresses: {
        create: [
          {
            label: "Recipient A",
            recipientName: "Recipient A",
            line1: "101 Purim Lane",
            city: "Brooklyn",
            region: "NY",
            postalCode: "11219",
            normalizedKey: `101-purim-${runKey}`,
          },
          {
            label: "Recipient B",
            recipientName: hebrewRecipient,
            line1: "202 Simcha Street",
            city: "Brooklyn",
            region: "NY",
            postalCode: "11219",
            normalizedKey: `202-simcha-${runKey}`,
          },
        ],
      },
    },
    include: { addresses: { orderBy: { recipientName: "asc" } } },
  });
  const order = await prisma.order.create({
    data: {
      seasonId,
      customerId: customer.id,
      draftReference: `D-P7-${runKey}`,
      subtotalCents: product.priceCents * 8,
      totalCents: product.priceCents * 8,
      lines: {
        create: customer.addresses.flatMap((address) =>
          methods.map((method) => ({
            productId: product.id,
            recipientAddressId: address.id,
            recipientSource: "ADDRESS_BOOK" as const,
            recipientNameSnapshot: address.recipientName,
            fulfillmentMethodId: method.id,
            greetingSnapshot:
              address.recipientName === hebrewRecipient
                ? "פורים שמח מכל הלב!"
                : `A freilichen Purim, ${address.recipientName}!`,
            productNameSnapshot: product.name,
            skuSnapshot: product.sku,
            unitPriceCentsSnapshot: product.priceCents,
            quantity: 2,
          })),
        ),
      },
    },
  });
  await finalizeOrder(prisma, order.id);
  let packages = await prisma.package.findMany({
    where: { orderId: order.id, isActive: true },
    include: { lines: true, fulfillmentMethod: true },
    orderBy: { id: "asc" },
  });
  assert.equal(packages.length, 4, "Two recipients by two methods must produce four packages.");

  const splitSource = packages[0]!;
  const splitLine = splitSource.lines[0]!;
  await post("/api/admin/packages/actions", {
    action: "split",
    packageId: splitSource.id,
    packageLineId: splitLine.id,
    quantity: 1,
  });
  packages = await prisma.package.findMany({
    where: { orderId: order.id, isActive: true },
    include: { lines: true, fulfillmentMethod: true },
    orderBy: { id: "asc" },
  });
  assert.equal(packages.length, 5);
  const regroupSource = packages.find(
    (entry) =>
      entry.id !== splitSource.id &&
      entry.lines.some((line) => line.quantity > 1),
  )!;
  const regroupLine = regroupSource.lines.find((line) => line.quantity > 1)!;
  const secondSplit = (await post("/api/admin/packages/actions", {
    action: "split",
    packageId: regroupSource.id,
    packageLineId: regroupLine.id,
    quantity: 1,
  })) as { createdPackage: { id: string } };
  await post("/api/admin/packages/actions", {
    action: "regroup",
    sourcePackageId: secondSplit.createdPackage.id,
    targetPackageId: regroupSource.id,
  });
  packages = await prisma.package.findMany({
    where: { orderId: order.id, isActive: true },
    include: { lines: true, fulfillmentMethod: true },
    orderBy: { id: "asc" },
  });
  assert.equal(packages.length, 5);
  const retainedRegroupSource = await prisma.package.findUniqueOrThrow({
    where: { id: secondSplit.createdPackage.id },
    include: { audits: true },
  });
  assert.equal(retainedRegroupSource.isActive, false);
  assert(
    retainedRegroupSource.audits.some(
      (audit) => audit.action === "package.regrouped.source",
    ),
  );
  assert.equal(
    await prisma.packageAudit.count({
      where: {
        packageId: { in: packages.map((entry) => entry.id) },
        action: { in: ["package.split.source", "package.split.created"] },
      },
    }),
    3,
  );
  console.log("S1 PASS 2 recipients × 2 methods grouped; split/regroup retained package audits");

  await prisma.printBatch.deleteMany({ where: { runKey: `nightly:${nightlyDateKey}` } });
  const beforePrintStages = packages.map((entry) => entry.stage);
  const nightly = (await post("/api/admin/print-batches", {
    action: "nightly",
    dateKey: nightlyDateKey,
  })) as {
    batch: {
      id: string;
      artifacts: Array<{ id: string; kind: string; filingGroup: string }>;
    };
    replayed: boolean;
  };
  assert.equal(nightly.replayed, false);
  assert(nightly.batch.artifacts.some((artifact) => artifact.kind === "SLIPS"));
  assert(nightly.batch.artifacts.some((artifact) => artifact.kind === "LABELS"));
  assert(nightly.batch.artifacts.some((artifact) => artifact.kind === "GREETING_CARDS"));
  assert(nightly.batch.artifacts.some((artifact) => artifact.kind === "PACKING_SLIP"));
  const afterPrintStages = (
    await prisma.package.findMany({
      where: { id: { in: packages.map((entry) => entry.id) } },
      orderBy: { id: "asc" },
      select: { stage: true },
    })
  ).map((entry) => entry.stage);
  assert.deepEqual(afterPrintStages, beforePrintStages);

  let statusPackage = await prisma.package.findUniqueOrThrow({
    where: { id: packages[0]!.id },
  });
  for (const stage of ["PRINTED", "PACKED", "SENT"] as const) {
    await post("/api/admin/packages/actions", {
      action: "status",
      packages: [
        {
          packageId: statusPackage.id,
          version: statusPackage.version,
          stage,
        },
      ],
    });
    statusPackage = await prisma.package.findUniqueOrThrow({
      where: { id: statusPackage.id },
    });
    assert.equal(statusPackage.stage, stage);
  }
  console.log("S2 PASS slips, labels, cards, packing slip PDFs left stages unchanged; status advanced separately");

  const artifactCount = nightly.batch.artifacts.length;
  const replay = (await post("/api/admin/print-batches", {
    action: "nightly",
    dateKey: nightlyDateKey,
  })) as { batch: { id: string; artifacts: unknown[] }; replayed: boolean };
  assert.equal(replay.replayed, true);
  assert.equal(replay.batch.id, nightly.batch.id);
  assert.equal(replay.batch.artifacts.length, artifactCount);

  const reprintGroup = packages.find((entry) => entry.id !== statusPackage.id)!.fulfillmentMethod.code;
  const groupReprint = (await post("/api/admin/print-batches", {
    action: "reprint-group",
    filingGroup: reprintGroup,
  })) as {
    batch: { artifacts: Array<{ kind: string; filingGroup: string }> };
  };
  assert(
    groupReprint.batch.artifacts
      .filter((artifact) => artifact.kind !== "PACKING_SLIP")
      .every((artifact) => artifact.filingGroup === reprintGroup),
  );
  const orderReprint = (await post("/api/admin/print-batches", {
    action: "reprint-order",
    orderId: order.id,
  })) as {
    batch: { artifacts: Array<{ id: string; payload: unknown }> };
  };
  for (const artifact of orderReprint.batch.artifacts) {
    const payload = artifact.payload as {
      orderIds: string[];
      pages: { recipient: string; greeting: string }[];
    };
    assert.deepEqual(payload.orderIds, [order.id]);
    assert(
      payload.pages.some(
        (page) =>
          page.recipient === hebrewRecipient && page.greeting.includes("פורים שמח"),
      ),
      "Reprint payload must preserve Hebrew recipient and greeting text.",
    );
  }
  const printablePackage = await prisma.package.findFirstOrThrow({
    where: { orderId: order.id, id: { not: statusPackage.id } },
  });
  assert.notEqual(printablePackage.stage, "SENT");
  const pdfResponse = await request(
    `/api/admin/print-artifacts/${orderReprint.batch.artifacts[0]!.id}`,
  );
  assert.equal(pdfResponse.status, 200);
  assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1\./);
  assert.match(pdf.toString("latin1"), /\/ToUnicode/);
  const boardResponse = await request("/admin/fulfillment");
  assert.equal(boardResponse.status, 200);
  assert.match(await boardResponse.text(), /Package production/);
  console.log("S3 PASS nightly replay idempotent; group/order reprints isolated; PDF valid; printed remains unshipped");
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
