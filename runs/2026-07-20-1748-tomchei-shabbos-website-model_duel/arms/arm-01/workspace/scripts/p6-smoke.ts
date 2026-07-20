import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { listOrders, repeatOrders } from "../src/lib/admin-operations";

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

function authHeaders(userId: string) {
  const timestamp = Date.now();
  const signature = createHmac("sha256", authSecret)
    .update(`${userId}.${timestamp}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-test-clerk-user-id": userId,
    "x-test-auth-token": `${timestamp}.${signature}`,
  };
}

async function request(path: string, userId: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(userId), ...init?.headers },
  });
}

async function createPreparedOrder(
  customerId: string,
  seasonId: string,
  product: { id: string; name: string; sku: string; priceCents: number },
  addressId: string,
  fulfillmentMethodId: string,
  status: "DRAFT" | "FINALIZED",
) {
  return prisma.order.create({
    data: {
      seasonId,
      customerId,
      status,
      orderNumber: status === "FINALIZED" ? Math.floor(Math.random() * 1_000_000) + 2_000_000 : null,
      draftReference: `D-P6-${runKey}-${randomUUID().slice(0, 6)}`,
      subtotalCents: product.priceCents,
      totalCents: product.priceCents,
      finalizedAt: status === "FINALIZED" ? new Date() : null,
      lines: {
        create: {
          productId: product.id,
          recipientAddressId: addressId,
          recipientSource: "ADDRESS_BOOK",
          recipientNameSnapshot: "P6 recipient",
          fulfillmentMethodId,
          greetingSnapshot: "A freilichen Purim!",
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          unitPriceCentsSnapshot: product.priceCents,
          quantity: 1,
        },
      },
    },
  });
}

async function run() {
  const seasonSetting = await prisma.appSetting.findUniqueOrThrow({ where: { key: "current-season-id" } });
  const seasonId = String(seasonSetting.value);
  const manager = await prisma.staffUser.upsert({
    where: { email: "p6.manager@example.test" },
    update: {
      role: "MANAGER",
      status: "ACTIVE",
      clerkUserId: "p6_manager",
      grantPermissions: [],
      denyPermissions: [],
    },
    create: {
      email: "p6.manager@example.test",
      displayName: "P6 Manager",
      role: "MANAGER",
      status: "ACTIVE",
      clerkUserId: "p6_manager",
      confirmedAt: new Date(),
    },
  });
  const staff = await prisma.staffUser.upsert({
    where: { email: "p6.restricted.staff@example.test" },
    update: { status: "ACTIVE", role: "STAFF", clerkUserId: "p6_restricted_staff" },
    create: {
      email: "p6.restricted.staff@example.test",
      displayName: "P6 Restricted Staff",
      role: "STAFF",
      status: "ACTIVE",
      clerkUserId: "p6_restricted_staff",
      confirmedAt: new Date(),
    },
  });
  const customer = await prisma.customer.findFirstOrThrow();
  const address = await prisma.customerAddress.findFirstOrThrow({ where: { customerId: customer.id } });
  const product = await prisma.product.findFirstOrThrow({
    where: { seasonId, kind: "PACKAGE", isActive: true },
    include: { inventoryItem: true },
  });
  if (product.inventoryItem) {
    await prisma.inventoryItem.update({ where: { id: product.inventoryItem.id }, data: { onHand: 20_000 } });
  }
  const pickup = await prisma.fulfillmentMethod.findFirstOrThrow({
    where: { seasonId, code: "PICKUP", isActive: true },
  });

  const refundOrder = await createPreparedOrder(
    customer.id,
    seasonId,
    product,
    address.id,
    pickup.id,
    "FINALIZED",
  );
  const stripePayment = await prisma.payment.create({
    data: {
      orderId: refundOrder.id,
      method: "STRIPE",
      amountCents: product.priceCents,
      reference: `pi_local_p6_${runKey}`,
    },
  });
  await prisma.stripePaymentIntent.create({
    data: {
      orderId: refundOrder.id,
      stripePaymentIntentId: stripePayment.reference!,
      idempotencyKey: `p6-${runKey}`,
      status: "SUCCEEDED",
      amountCents: product.priceCents,
    },
  });
  await prisma.order.update({ where: { id: refundOrder.id }, data: { cachedPaymentStatus: "PAID" } });

  for (const path of ["/admin", "/admin/today", "/admin/orders", `/admin/orders/${refundOrder.id}`, "/admin/audit"]) {
    assert.equal((await request(path, "p6_manager")).status, 200, `manager route ${path}`);
    assert.equal((await request(path, staff.clerkUserId!)).status, 200, `staff route ${path}`);
  }
  for (const path of ["/admin/pos", "/admin/customers", "/admin/imports", "/admin/settings"]) {
    assert.equal((await request(path, "p6_manager")).status, 200, `manager route ${path}`);
  }
  const settingsResponse = await request("/api/admin/settings", "p6_manager", {
    method: "PATCH",
    body: JSON.stringify({
      seasonId,
      adminSettings: {
        followUpDays: 3,
        emailSenderName: "Tomchei Shabbos",
        operationsAlert: "Purim operations are live.",
        developerWebhookLabel: "Stripe checkout webhook",
      },
    }),
  });
  assert.equal(settingsResponse.status, 200, await settingsResponse.text());
  const deniedRefund = await request(
    `/api/admin/orders/${refundOrder.id}/refunds`,
    staff.clerkUserId!,
    { method: "POST", body: JSON.stringify({ paymentId: stripePayment.id, amountCents: 100, reason: "Denied smoke" }) },
  );
  assert.equal(deniedRefund.status, 403);
  const refund = await request(
    `/api/admin/orders/${refundOrder.id}/refunds`,
    "p6_manager",
    { method: "POST", body: JSON.stringify({ paymentId: stripePayment.id, amountCents: product.priceCents, reason: "P6 smoke refund" }) },
  );
  assert.equal(refund.status, 200, await refund.text());
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: refundOrder.id } })).cachedPaymentStatus, "REFUNDED");
  console.log("S1 PASS manager/staff hub, detail, Stripe refund, audit");

  const posDraft = await createPreparedOrder(
    customer.id,
    seasonId,
    product,
    address.id,
    pickup.id,
    "DRAFT",
  );
  const posResponse = await request(
    `/api/admin/pos/orders/${posDraft.id}/checkout`,
    "p6_manager",
    {
      method: "POST",
      body: JSON.stringify({
        method: "CASH",
        reference: `P6-CASH-${runKey}`,
        choices: [{
          orderLineId: (await prisma.orderLine.findFirstOrThrow({ where: { orderId: posDraft.id } })).id,
          fulfillmentCode: "PICKUP",
          greeting: "A freilichen Purim!",
        }],
      }),
    },
  );
  assert.equal(posResponse.status, 201, await posResponse.text());
  const finalizedPos = await prisma.order.findUniqueOrThrow({ where: { id: posDraft.id }, include: { payments: true } });
  assert.equal(finalizedPos.status, "FINALIZED");
  assert.equal(finalizedPos.payments[0]?.postedByStaffId, manager.id);
  const repeated = await request("/api/admin/orders/bulk-repeat", "p6_manager", {
    method: "POST",
    body: JSON.stringify({ sources: [{ orderId: finalizedPos.id, version: finalizedPos.version }] }),
  });
  assert.equal(repeated.status, 200, await repeated.text());
  console.log("S2 PASS shared-builder POS cash audit and bounded repeat");

  const mixedStage = await request("/api/admin/imports", "p6_manager", {
    method: "POST",
    body: JSON.stringify({
      entityType: "customers",
      sourceName: `mixed-${runKey}.csv`,
      csv: `displayName,email,phone\nValid ${runKey},valid-${runKey}@example.test,\nDuplicate A,dupe-${runKey}@example.test,\nDuplicate B,dupe-${runKey}@example.test,\nInvalid,,`,
    }),
  });
  assert.equal(mixedStage.status, 201, await mixedStage.clone().text());
  const mixedBatch = (await mixedStage.json()).batch;
  assert(mixedBatch.invalidRowCount > 0 && mixedBatch.duplicateCount > 0);
  const correctedStage = await request("/api/admin/imports", "p6_manager", {
    method: "POST",
    body: JSON.stringify({
      entityType: "customers",
      sourceName: `corrected-${runKey}.csv`,
      csv: `displayName,email,phone\nImported ${runKey},imported-${runKey}@example.test,`,
    }),
  });
  assert.equal(correctedStage.status, 201, await correctedStage.clone().text());
  const correctedBatch = (await correctedStage.json()).batch;
  const commit = await request(`/api/admin/imports/${correctedBatch.id}/commit`, "p6_manager", { method: "POST" });
  assert.equal(commit.status, 200, await commit.text());
  assert(await prisma.auditLog.findFirst({ where: { action: "import.committed", targetId: correctedBatch.id } }));
  console.log("S3 PASS mixed preview, blocked issues, atomic commit, audit");

  await prisma.package.deleteMany({ where: { order: { draftReference: { startsWith: "P6-SCALE-" } } } });
  await prisma.order.deleteMany({ where: { draftReference: { startsWith: "P6-SCALE-" } } });
  await prisma.order.createMany({
    data: Array.from({ length: 1000 }, (_, index) => ({
      seasonId,
      customerId: customer.id,
      draftReference: `P6-SCALE-${String(index).padStart(4, "0")}`,
      subtotalCents: product.priceCents,
      totalCents: product.priceCents,
    })),
  });
  const scaleOrders = await prisma.order.findMany({
    where: { draftReference: { startsWith: "P6-SCALE-" } },
    select: { id: true },
    orderBy: { draftReference: "asc" },
  });
  await prisma.package.createMany({
    data: scaleOrders.flatMap((order) =>
      Array.from({ length: 5 }, (_, packageIndex) => ({
        orderId: order.id,
        fulfillmentMethodId: pickup.id,
        recipientName: `Scale recipient ${packageIndex}`,
        greetingSnapshot: "",
        groupingKey: `scale-${packageIndex}`,
      })),
    ),
  });
  assert.equal((await listOrders({ page: 1 })).orders.length, 25);
  assert.equal((await listOrders({ page: 40 })).orders.length, 25);
  assert.equal(await prisma.package.count({ where: { order: { draftReference: { startsWith: "P6-SCALE-" } } } }), 5000);
  const conflicts = await repeatOrders(manager.id, [
    { orderId: finalizedPos.id, version: finalizedPos.version },
    { orderId: finalizedPos.id, version: finalizedPos.version },
    { orderId: refundOrder.id, version: refundOrder.version + 100 },
  ]);
  assert.equal(conflicts.applied.length, 1);
  assert.equal(conflicts.conflicts.length, 2);
  assert.deepEqual(
    conflicts.conflicts.map((conflict) => conflict.orderId),
    [...conflicts.conflicts.map((conflict) => conflict.orderId)].sort(),
  );
  console.log("S4 PASS 1k-order pages, 5k packages, deterministic conflicts");
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
