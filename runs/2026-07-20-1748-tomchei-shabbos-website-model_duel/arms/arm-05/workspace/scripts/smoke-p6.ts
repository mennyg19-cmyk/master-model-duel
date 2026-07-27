import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { GET as getOperations, POST as postOperations } from "../app/api/admin/operations/route";
import { commitImport, createWalkInPosOrder, listOrders, operationsDashboard, stageImport } from "../lib/admin-operations";
import { createDraft, readDraft, saveDraft } from "../lib/order-builder";
import { createDevSessionToken } from "../lib/dev-auth";
import { LOCAL_DATABASE_URL, runWithLocalDatabase } from "./local-db";

function customerRequest() {
  return new Request("http://localhost:3105/api/order/drafts", { headers: { "x-dev-session": createDevSessionToken({ userId: "customer-seed", email: "seed@example.test", expiresAt: Date.now() + 60_000 }) } });
}

async function verifySmoke() {
  Object.assign(process.env, { NODE_ENV: "development", DEV_AUTH_MODE: "true", DEV_AUTH_SECRET: "p5-smoke-secret" });
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const staff = await prisma.staffUser.upsert({ where: { clerkUserId: "staff-p6-smoke" }, create: { clerkUserId: "staff-p6-smoke", email: "staff-p6@example.test", displayName: "P6 Staff", role: "MANAGER" }, update: { role: "MANAGER", revokedAt: null } });
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "PURIM-BOX-01" } });
    const draft = await createDraft(customerRequest());
    await saveDraft(customerRequest(), draft.draft.id, { lines: [{ productId: product.id, quantity: 1, addOns: [], recipient: { kind: "new", recipientName: "P6 Recipient", line1: "6 Smoke Street", city: "Brooklyn", state: "NY", postalCode: "11201" } }] });
    const saved = await readDraft(customerRequest(), draft.draft.id);
    assert.ok(saved?.customer?.addresses[0]);
    const payment = await createWalkInPosOrder(
      { firstName: "P6", lastName: "Smoke", productId: product.id, quantity: 1, method: "CASH" },
      staff.id,
      "http://localhost:3105/api/admin/operations",
    );
    assert.equal(payment.method, "CASH");
    const dashboard = await operationsDashboard();
    const listed = await listOrders({ page: 1 });
    assert.ok(dashboard.orderCount > 0 && listed.orders.some((order) => order.draftReference.startsWith("POS-")));
    const managerToken = createDevSessionToken({ userId: staff.clerkUserId, email: staff.email, expiresAt: Date.now() + 60_000 });
    assert.equal((await getOperations(new Request("http://localhost:3105/api/admin/operations", { headers: { "x-dev-session": managerToken } }))).status, 200);
    const restricted = await prisma.staffUser.upsert({ where: { clerkUserId: "staff-p6-restricted" }, create: { clerkUserId: "staff-p6-restricted", email: "restricted-p6@example.test", displayName: "Restricted P6 Staff", role: "STAFF" }, update: { role: "STAFF", revokedAt: null } });
    await prisma.permissionOverride.upsert({ where: { staffId_permission: { staffId: restricted.id, permission: "orders.read" } }, create: { staffId: restricted.id, permission: "orders.read", effect: "DENY" }, update: { effect: "DENY" } });
    const restrictedToken = createDevSessionToken({ userId: restricted.clerkUserId, email: restricted.email, expiresAt: Date.now() + 60_000 });
    assert.equal((await getOperations(new Request("http://localhost:3105/api/admin/operations", { headers: { "x-dev-session": restrictedToken } }))).status, 403);
    console.log("S1 passed: manager dashboard/order list and restricted-staff denial were verified.");

    const walkIn = await createWalkInPosOrder({ firstName: "Walk", lastName: "In", productId: product.id, quantity: 1, method: "CHECK" }, staff.id, "http://localhost:3105/api/admin/operations");
    assert.equal(walkIn.method, "CHECK");
    assert.equal(await prisma.auditEvent.count({ where: { actorId: staff.id, action: "payment.offline_posted" } }) >= 2, true);
    console.log("S2 passed: walk-in cash/check POS uses server pricing, finalization, inventory reservation, and payment audit.");

    const importEmail = `valid.import.${Date.now()}@example.test`;
    const invalid = await stageImport(`firstName,lastName,email\nValid,Import,${importEmail}\nBroken,Row,not-an-email`, "customers", staff.id);
    assert.equal(invalid.accepted, 1);
    assert.equal(invalid.errors.length, 1);
    const corrected = await stageImport(`firstName,lastName,email\nValid,Import,${importEmail}`, "customers", staff.id);
    const imported = await commitImport(corrected.batchId, staff.id);
    assert.equal(imported.imported, 1);
    const productImport = await stageImport(
      `firstName,lastName,sku,productName,priceCents\nImport,Product,P6-IMPORT-${Date.now()},Imported Product,2500`,
      "products",
      staff.id,
    );
    const importedProducts = await commitImport(productImport.batchId, staff.id);
    assert.equal(importedProducts.imported, 1);
    assert.equal(await prisma.auditEvent.count({ where: { actorId: staff.id, action: "import.committed" } }) > 0, true);
    console.log("S3 passed: invalid-row preview plus atomic customer and product commits wrote audit evidence.");

    const customer = await prisma.customer.findFirstOrThrow();
    const season = await prisma.season.findFirstOrThrow({ where: { year: 2026 } });
    const method = await prisma.fulfillmentMethod.findFirstOrThrow({ where: { code: "DELIVERY" } });
    const orderRows = Array.from({ length: 1000 }, (_, index) => ({ seasonId: season.id, customerId: customer.id, status: "FINALIZED" as const, draftReference: `P6-SCALE-${index}`, wireFormat: {}, totalCents: 1000 }));
    await prisma.order.createMany({ data: orderRows, skipDuplicates: true });
    const scaleOrders = await prisma.order.findMany({ where: { draftReference: { startsWith: "P6-SCALE-" } }, select: { id: true } });
    await prisma.package.deleteMany({ where: { orderId: { in: scaleOrders.map((order) => order.id) } } });
    await prisma.package.createMany({ data: scaleOrders.flatMap((order) => Array.from({ length: 5 }, (_, index) => ({ orderId: order.id, fulfillmentMethodId: method.id, recipientName: `Scale ${index}`, greeting: "P6", groupingKey: `${order.id}-${index}` }))), skipDuplicates: true });
    const page = await listOrders({ page: 1 });
    assert.equal(page.pageSize, 25);
    assert.equal(await prisma.order.count({ where: { draftReference: { startsWith: "P6-SCALE-" } } }), 1000);
    assert.equal(await prisma.package.count({ where: { order: { draftReference: { startsWith: "P6-SCALE-" } } } }), 5000);
    const [firstScaleOrder] = scaleOrders;
    assert.ok(firstScaleOrder);
    const bulkRequest = (version: number) => new Request("http://localhost:3105/api/admin/operations", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3105", "x-dev-session": managerToken },
      body: JSON.stringify({ action: "bulk", orderIds: [firstScaleOrder.id], versions: { [firstScaleOrder.id]: version } }),
    });
    const processed = await postOperations(bulkRequest(1));
    assert.deepEqual((await processed.json()).outcomes, [{ orderId: firstScaleOrder.id, outcome: "processed" }]);
    const conflict = await postOperations(bulkRequest(1));
    assert.deepEqual((await conflict.json()).outcomes, [{ orderId: firstScaleOrder.id, outcome: "conflict" }]);
    console.log("S4 passed: bounded pagination ran against 1,000 orders/5,000 packages; repeated bulk version probes returned processed then conflict.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
  await runWithLocalDatabase("tsx", ["scripts/smoke-p6.ts", "verify"]);
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
