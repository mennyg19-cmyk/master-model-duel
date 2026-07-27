import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createDevSessionToken } from "../lib/dev-auth";
import { isProductAvailable } from "../lib/inventory";
import { createDraft, readDraft, saveDraft, updateCustomerAddress } from "../lib/order-builder";
import { LOCAL_DATABASE_URL, runWithLocalDatabase } from "./local-db";

function authenticatedRequest(userId: string, email: string) {
  const token = createDevSessionToken({ userId, email, expiresAt: Date.now() + 60_000 });
  return new Request("http://localhost:3105/api/order/drafts", { headers: { "x-dev-session": token } });
}

function guestRequest(token?: string) {
  return new Request("http://localhost:3105/api/order/drafts", {
    headers: token ? { "x-draft-access-token": token } : {},
  });
}

async function verifySmoke() {
  Object.assign(process.env, {
    NODE_ENV: "development",
    DEV_AUTH_MODE: "true",
    DEV_AUTH_SECRET: "p4-smoke-secret",
  });
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const [customer, catalog] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { emailNormalized: "seed@example.test" }, include: { addresses: true } }),
      prisma.product.findMany({ where: { season: { year: 2026 }, isActive: true, kind: "PACKAGE" }, include: { inventoryItems: true }, orderBy: { sku: "asc" } }),
    ]);
    const products = catalog.filter(isProductAvailable);
    assert.equal(products.length >= 2, true);
    const savedAddress = customer.addresses[0]!;

    const signedIn = authenticatedRequest("customer-seed", "seed@example.test");
    const { draft } = await createDraft(signedIn);
    const saved = await saveDraft(signedIn, draft.id, {
      lines: [
        { productId: products[0]!.id, quantity: 1, addOns: [], recipient: { kind: "self", addressId: savedAddress.id } },
        { productId: products[0]!.id, quantity: 1, addOns: [], recipient: { kind: "saved", addressId: savedAddress.id } },
        {
          productId: products[1]!.id,
          quantity: 1,
          addOns: [],
          recipient: { kind: "new", recipientName: "New Recipient", line1: "42 New Street", city: "Brooklyn", state: "ny", postalCode: "11211" },
        },
      ],
    });
    assert.equal(saved.lines.length, 3);
    assert.equal(saved.totalCents, products[0]!.priceCents * 2 + products[1]!.priceCents);
    const newAddress = await prisma.address.findFirstOrThrow({
      where: { customerId: customer.id, normalizedAddress: "42 new street|brooklyn|ny|11211|us" },
    });
    assert.notEqual(newAddress.latitude, null);
    assert.notEqual(newAddress.longitude, null);
    console.log("S1 passed: three-way recipient assignment saved a new address and matched cart totals.");

    const restored = await readDraft(signedIn, draft.id);
    assert.equal(restored?.lines.length, 3);
    const guest = await createDraft(guestRequest());
    assert.ok(guest.guestToken);
    await saveDraft(guestRequest(guest.guestToken!), guest.draft.id, {
      lines: [{ productId: products[0]!.id, quantity: 1, addOns: [], recipient: { kind: "new", recipientName: "Guest Recipient", line1: "10 Guest Road", city: "Brooklyn", state: "NY", postalCode: "11201" } }],
    });
    assert.ok(await readDraft(guestRequest(guest.guestToken!), guest.draft.id));
    assert.equal(await readDraft(guestRequest(), guest.draft.id), null);
    console.log("S2 passed: authenticated and guest drafts restore; guest token isolates a second browser and remains until checkout succeeds.");

    await updateCustomerAddress(customer.id, newAddress.id, {
      recipientName: "New Recipient",
      line1: "42 New Street",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11211",
      label: "Friend",
    });
    await assert.rejects(
      updateCustomerAddress(customer.id, newAddress.id, {
        recipientName: savedAddress.recipientName,
        line1: savedAddress.line1,
        line2: savedAddress.line2,
        city: savedAddress.city,
        state: savedAddress.state,
        postalCode: savedAddress.postalCode,
        label: savedAddress.label,
      }),
      /Another saved address already uses these details/,
    );
    const staff = await prisma.staffUser.upsert({
      where: { clerkUserId: "staff-p4-smoke" },
      create: { clerkUserId: "staff-p4-smoke", email: "staff-p4@example.test", displayName: "P4 Staff", role: "STAFF" },
      update: {},
    });
    await updateCustomerAddress(customer.id, newAddress.id, {
      recipientName: "New Recipient",
      line1: "42 New Street",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11211",
      label: "Friend",
    }, staff.id);
    const audit = await prisma.auditEvent.findFirst({ where: { actorId: staff.id, action: "customer.address_updated", subjectId: newAddress.id } });
    assert.ok(audit);
    console.log("S3 passed: address edits preserve ownership, reject normalized collisions, and create staff audit events.");
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
  await runWithLocalDatabase("tsx", ["scripts/smoke-p4.ts", "verify"]);
}

void (process.argv[2] === "verify" ? verifySmoke() : runSmoke()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
