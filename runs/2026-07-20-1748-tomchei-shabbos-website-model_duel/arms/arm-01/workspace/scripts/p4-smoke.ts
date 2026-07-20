import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createLocalTestAuthToken } from "../src/lib/auth";

const prisma = new PrismaClient();
const baseUrl = "http://127.0.0.1:3101";

function authHeaders(clerkUserId: string) {
  return {
    "content-type": "application/json",
    "x-test-clerk-user-id": clerkUserId,
    "x-test-auth-token": createLocalTestAuthToken(clerkUserId),
  };
}

async function readJson(response: Response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function runSmoke() {
  const currentSeasonSetting = await prisma.appSetting.findUniqueOrThrow({
    where: { key: "current-season-id" },
  });
  assert.equal(typeof currentSeasonSetting.value, "string");
  const season = await prisma.season.findFirstOrThrow({
    where: { id: currentSeasonSetting.value as string, status: "OPEN" },
    include: {
      products: {
        where: { kind: "PACKAGE", isActive: true },
        include: {
          options: true,
          inventoryItem: true,
          allowedAddOns: { include: { addOn: true } },
        },
        orderBy: { priceCents: "asc" },
      },
    },
  });
  const customerAccount = await prisma.customerAccount.findUniqueOrThrow({
    where: { clerkUserId: "seed_customer" },
  });
  const originalAddress = await prisma.customerAddress.findFirstOrThrow({
    where: { customerId: customerAccount.customerId! },
    orderBy: { createdAt: "asc" },
  });
  const customerHeaders = authHeaders("seed_customer");

  const draftPayload = await readJson(
    await fetch(`${baseUrl}/api/order/drafts`, {
      method: "POST",
      headers: customerHeaders,
      body: "{}",
    }),
  );
  const draftId = draftPayload.order.id as string;
  const savedAddressPayload = await readJson(
    await fetch(`${baseUrl}/api/account/addresses`, {
      method: "POST",
      headers: customerHeaders,
      body: JSON.stringify({
        draftId,
        label: "Smoke saved",
        recipientName: "Saved Recipient",
        line1: "20 Smoke Lane",
        city: "Lakewood",
        region: "NJ",
        postalCode: "08701",
      }),
    }),
  );
  const newAddressPayload = await readJson(
    await fetch(`${baseUrl}/api/account/addresses`, {
      method: "POST",
      headers: customerHeaders,
      body: JSON.stringify({
        draftId,
        label: "Smoke new",
        recipientName: "New Recipient",
        line1: "30 Smoke Lane",
        city: "Lakewood",
        region: "NJ",
        postalCode: "08701",
      }),
    }),
  );
  const packageProduct = season.products.find(
    (product) =>
      product.allowedAddOns.length > 0 &&
      (!product.tracksInventory ||
        (product.inventoryItem?.onHand ?? 0) - (product.inventoryItem?.reserved ?? 0) > 0),
  )!;
  assert.ok(packageProduct, "Current season needs an in-stock product with an allowed add-on.");
  const secondProduct = season.products.find(
    (product) =>
      product.id !== packageProduct.id &&
      product.priceCents > 0 &&
      (!product.tracksInventory ||
        (product.inventoryItem?.onHand ?? 0) - (product.inventoryItem?.reserved ?? 0) > 0),
  )!;
  const selectedOption =
    packageProduct.options.find((option) => option.priceAdjustmentCents > 0) ??
    packageProduct.options[0];
  const selectedAddOn = packageProduct.allowedAddOns[0]?.addOn;
  const lines = [
    {
      productId: packageProduct.id,
      productOptionId: selectedOption?.id,
      addOnIds: selectedAddOn ? [selectedAddOn.id] : [],
      quantity: 1,
      recipientAddressId: originalAddress.id,
      recipientSource: "ON_ORDER",
    },
    {
      productId: secondProduct.id,
      quantity: 1,
      recipientAddressId: savedAddressPayload.address.id,
      recipientSource: "ADDRESS_BOOK",
    },
    {
      productId: packageProduct.id,
      quantity: 1,
      recipientAddressId: newAddressPayload.address.id,
      recipientSource: "NEW_RECIPIENT",
    },
  ];
  const savedDraft = await readJson(
    await fetch(`${baseUrl}/api/order/drafts/${draftId}`, {
      method: "PATCH",
      headers: customerHeaders,
      body: JSON.stringify({ version: draftPayload.order.version, lines }),
    }),
  );
  const expectedTotal =
    packageProduct.priceCents +
    (selectedOption?.priceAdjustmentCents ?? 0) +
    (selectedAddOn?.priceCents ?? 0) +
    secondProduct.priceCents +
    packageProduct.priceCents;
  assert.equal(savedDraft.order.lines.length, 3);
  assert.equal(savedDraft.order.totalCents, expectedTotal);
  assert.equal(
    await prisma.customerAddress.count({
      where: {
        customerId: customerAccount.customerId!,
        normalizedKey: newAddressPayload.address.normalizedKey,
      },
    }),
    1,
  );

  const restoredDraft = await fetch(`${baseUrl}/api/order/drafts/${draftId}`, {
    headers: customerHeaders,
  });
  assert.equal(restoredDraft.status, 200);
  const forbiddenDraft = await fetch(`${baseUrl}/api/order/drafts/${draftId}`, {
    headers: authHeaders("other_customer"),
  });
  assert.equal(forbiddenDraft.status, 404);

  const guestDraftResponse = await fetch(`${baseUrl}/api/order/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Smoke Guest" }),
  });
  const guestCookie = guestDraftResponse.headers
    .get("set-cookie")
    ?.match(/draft_access_token=([^;]+)/)?.[1];
  assert.ok(guestCookie, "Guest draft must set an httpOnly access cookie.");
  const guestDraftPayload = await readJson(guestDraftResponse);
  assert.equal("accessToken" in guestDraftPayload, false);
  const guestAuthorization = {
    cookie: `draft_access_token=${guestCookie}`,
  };
  const dedupedGuestDraft = await readJson(
    await fetch(`${baseUrl}/api/order/drafts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...guestAuthorization,
      },
      body: "{}",
    }),
  );
  assert.equal(dedupedGuestDraft.order.id, guestDraftPayload.order.id);
  assert.equal(
    (
      await fetch(`${baseUrl}/api/order/drafts/${guestDraftPayload.order.id}`, {
        headers: guestAuthorization,
      })
    ).status,
    200,
  );
  const guestAddress = await readJson(
    await fetch(`${baseUrl}/api/account/addresses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...guestAuthorization,
      },
      body: JSON.stringify({
        draftId: guestDraftPayload.order.id,
        label: "Guest refresh",
        recipientName: "Guest Recipient",
        line1: "40 Smoke Lane",
        city: "Lakewood",
        region: "NJ",
        postalCode: "08701",
      }),
    }),
  );
  const guestAddresses = await readJson(
    await fetch(
      `${baseUrl}/api/account/addresses?draftId=${guestDraftPayload.order.id}`,
      { headers: guestAuthorization },
    ),
  );
  assert.ok(
    guestAddresses.addresses.some(
      (address: { id: string }) => address.id === guestAddress.address.id,
    ),
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/order/drafts/${guestDraftPayload.order.id}`)).status,
    404,
  );
  const guestSuccess = await fetch(
    `${baseUrl}/api/order/drafts/${guestDraftPayload.order.id}/success`,
    { method: "POST", headers: guestAuthorization },
  );
  assert.equal(guestSuccess.status, 200);
  assert.match(guestSuccess.headers.get("set-cookie") ?? "", /draft_access_token=;/);
  assert.equal(
    (
      await fetch(`${baseUrl}/api/order/drafts/${guestDraftPayload.order.id}`, {
        headers: guestAuthorization,
      })
    ).status,
    404,
  );

  const editedCustomerAddress = await readJson(
    await fetch(`${baseUrl}/api/account/addresses/${savedAddressPayload.address.id}`, {
      method: "PATCH",
      headers: customerHeaders,
      body: JSON.stringify({
        draftId,
        version: savedAddressPayload.address.version,
        label: "Customer edited",
        recipientName: "Saved Recipient",
        line1: "20  Smoke Lane",
        city: "Lakewood",
        region: "nj",
        postalCode: "08701",
      }),
    }),
  );
  assert.equal(editedCustomerAddress.address.region, "NJ");
  assert.equal(editedCustomerAddress.address.geocodeProvider, "server-postal-validation");

  const manager = await prisma.staffUser.findFirst({
    where: { role: "MANAGER", status: "ACTIVE" },
  });
  if (!manager) {
    await prisma.staffUser.create({
      data: {
        clerkUserId: "p4_smoke_manager",
        email: "p4.smoke.manager@example.test",
        displayName: "P4 Smoke Manager",
        role: "MANAGER",
        status: "ACTIVE",
        confirmedAt: new Date(),
      },
    });
  }
  const staffHeaders = authHeaders("__local_manager__");
  const staffEditedAddress = await readJson(
    await fetch(
      `${baseUrl}/api/admin/customer-addresses/${editedCustomerAddress.address.id}`,
      {
        method: "PATCH",
        headers: staffHeaders,
        body: JSON.stringify({
          version: editedCustomerAddress.address.version,
          label: "Staff verified",
          recipientName: "Saved Recipient",
          line1: "20 Smoke Lane",
          city: "Lakewood",
          region: "NJ",
          postalCode: "08701",
        }),
      },
    ),
  );
  assert.equal(staffEditedAddress.address.label, "Staff verified");
  assert.ok(
    await prisma.auditLog.findFirst({
      where: {
        targetType: "CustomerAddress",
        targetId: staffEditedAddress.address.id,
        action: "customer.address_updated",
      },
    }),
  );

  console.log(
    JSON.stringify({
      S1: { lines: 3, totalCents: expectedTotal, newRecipientSaved: true },
      S2: {
        authenticatedRestore: true,
        guestRestore: true,
        guestAddressRehydrated: true,
        crossCustomerStatus: 404,
        guestTokenRevokedAfterSuccess: true,
      },
      S3: {
        ownerEdit: true,
        normalizedDedupe: true,
        geocodeProvider: staffEditedAddress.address.geocodeProvider,
        staffAudit: true,
      },
    }),
  );
}

runSmoke()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
