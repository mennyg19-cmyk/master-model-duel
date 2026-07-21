import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient, AuditAction } from "@prisma/client";

const base = process.env.APP_URL || "http://127.0.0.1:3103";
const evidence = [];
const db = new PrismaClient();

function cookieHeader(userId, extra = "") {
  const parts = [`dev_user_id=${userId}`];
  if (extra) parts.push(extra);
  return { cookie: parts.join("; ") };
}

async function req(pathname, init = {}) {
  const res = await fetch(`${base}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, text, json, setCookie };
}

function push(id, check, pass, extra = {}) {
  evidence.push({ id, check, pass, ...extra });
}

function extractGuestCookie(setCookie) {
  for (const raw of setCookie) {
    const m = /guest_draft_token=([^;]+)/.exec(raw);
    if (m) return m[1];
  }
  return null;
}

async function main() {
  // Clean leftover smoke drafts for customer
  const customer = await db.customer.findFirst({
    where: { clerkUserId: "dev_customer_1" },
  });
  if (!customer) throw new Error("Seed customer missing — run db:seed");

  await db.order.updateMany({
    where: { customerId: customer.id, status: "DRAFT" },
    data: { status: "DISCARDED", discardedAt: new Date() },
  });

  // Restore seed stock so cart-aggregate / add-on checks are deterministic
  for (const [sku, onHand] of [
    ["FAMILY-BOX", 25],
    ["TOTE", 40],
    ["LIMITED-BOX", 0],
  ]) {
    const p = await db.product.findFirst({ where: { sku } });
    if (p) {
      await db.inventoryItem.updateMany({
        where: { productId: p.id },
        data: { onHand, reserved: 0 },
      });
    }
  }
  await db.inventoryItem.updateMany({
    where: { addOnId: { not: null } },
    data: { onHand: 10, reserved: 0 },
  });

  const products = await db.product.findMany({
    where: { sku: { in: ["FAMILY-BOX", "TOTE", "LIMITED-BOX"] }, isActive: true },
    include: { options: true, allowedAddOns: true, inventory: true, season: true },
  });
  const family = products.find((p) => p.sku === "FAMILY-BOX");
  const tote = products.find((p) => p.sku === "TOTE");
  const limited = products.find((p) => p.sku === "LIMITED-BOX");
  if (!family || !tote) throw new Error("Seed products missing");

  // --- S1: three-way assignment ---
  const create = await req("/api/drafts", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({}),
  });
  const draftRef = create.json?.draft?.draftRef;
  push("S1a", "Create auth draft", Boolean(draftRef), { draftRef, status: create.status });

  const add1 = await req(`/api/drafts/${draftRef}/lines`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      productId: family.id,
      productOptionId: family.options[0]?.id,
      quantity: 1,
    }),
  });
  const add2 = await req(`/api/drafts/${draftRef}/lines`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({ productId: tote.id, quantity: 2 }),
  });
  // Third line — family again (limited may be sold out)
  const add3 = await req(`/api/drafts/${draftRef}/lines`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      productId: family.id,
      quantity: 1,
      addOnIds: family.allowedAddOns[0] ? [family.allowedAddOns[0].addOnId] : [],
    }),
  });
  const lines = add3.json?.draft?.lines ?? [];
  push(
    "S1b",
    "Add 3 catalog lines",
    lines.length === 3 && add3.json?.draft?.subtotalCents > 0,
    {
      lineCount: lines.length,
      subtotalCents: add3.json?.draft?.subtotalCents,
      statuses: [add1.status, add2.status, add3.status],
    },
  );

  const addresses = await req("/api/addresses", {
    headers: cookieHeader("dev_customer_1"),
  });
  const home = addresses.json?.addresses?.find((a) => a.isDefault) ?? addresses.json?.addresses?.[0];
  const friend = addresses.json?.addresses?.find((a) => a.id === "seed-addr-customer-friend");

  const lineSelf = lines[0];
  const lineBook = lines[1];
  const lineNew = lines[2];

  const aSelf = await req(`/api/drafts/${draftRef}/assign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({ lineId: lineSelf.id, mode: "on_order" }),
  });
  const aBook = await req(`/api/drafts/${draftRef}/assign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      lineId: lineBook.id,
      mode: "address_book",
      savedAddressId: friend?.id || home?.id,
    }),
  });
  const newName = `Smoke Recipient ${Date.now()}`;
  const aNew = await req(`/api/drafts/${draftRef}/assign`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      lineId: lineNew.id,
      mode: "new_recipient",
      autoSaveNew: true,
      newRecipient: {
        label: "Smoke new",
        recipientName: newName,
        line1: "18 Avenue J",
        city: "Brooklyn",
        state: "NY",
        postalCode: "11230",
        country: "US",
      },
    }),
  });

  const afterAssign = aNew.json?.draft;
  const assignedOk =
    afterAssign?.lines?.every((l) => l.assigned) &&
    afterAssign?.unassignedCount === 0 &&
    aSelf.json?.ok &&
    aBook.json?.ok &&
    aNew.json?.ok;

  const bookAfter = await req("/api/addresses", {
    headers: cookieHeader("dev_customer_1"),
  });
  const newInBook = bookAfter.json?.addresses?.some((a) => a.recipientName === newName);

  const expectedSubtotal = afterAssign?.subtotalCents;
  const recomputed = (afterAssign?.lines ?? []).reduce((s, l) => s + l.lineTotalCents, 0);
  push(
    "S1c",
    "Three-way assign + new recipient in address book + totals match",
    Boolean(assignedOk && newInBook && expectedSubtotal === recomputed),
    {
      assignedOk,
      newInBook,
      expectedSubtotal,
      recomputed,
      savedAddressId: aNew.json?.savedAddressId,
    },
  );

  // Builder catalog live stock
  const catalog = await req("/api/builder/catalog");
  const familyCard = catalog.json?.products?.find((p) => p.sku === "FAMILY-BOX");
  const limitedCard = catalog.json?.products?.find((p) => p.sku === "LIMITED-BOX");
  push(
    "S1d",
    "Inventory-aware builder catalog + restricted add-ons",
    familyCard?.stockAvailable > 0 &&
      limitedCard?.stockAvailable === 0 &&
      (familyCard?.allowedAddOns ?? []).some((a) => a.isRestricted),
    {
      familyStock: familyCard?.stockAvailable,
      limitedStock: limitedCard?.stockAvailable,
    },
  );

  const orderPage = await req("/order", { headers: cookieHeader("dev_customer_1") });
  push(
    "S1e",
    "Builder shell UI (sidebar/FAB markers)",
    orderPage.status === 200 &&
      orderPage.text.includes("order-builder") &&
      (orderPage.text.includes("cart-fab") || orderPage.text.includes("cart-sidebar")),
    { status: orderPage.status },
  );

  // --- S2: draft persistence + anti-enumeration ---
  const mid = await req("/api/drafts", {
    headers: cookieHeader("dev_customer_1"),
  });
  push(
    "S2a",
    "Refresh restores auth draft",
    mid.json?.draft?.draftRef === draftRef && mid.json?.draft?.lines?.length === 3,
    { draftRef: mid.json?.draft?.draftRef, lines: mid.json?.draft?.lines?.length },
  );

  // Guest draft — cookie-only auth (no JSON token, no x-guest-draft-token header)
  const guestCreate = await req("/api/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ guest: true }),
  });
  const guestToken = extractGuestCookie(guestCreate.setCookie);
  const guestCookieFlags = (guestCreate.setCookie ?? []).join("; ");
  const guestRef = guestCreate.json?.draft?.draftRef;
  push(
    "S2b0",
    "Guest token only via httpOnly+secure Set-Cookie (not JSON body)",
    Boolean(guestToken) &&
      guestCreate.json?.draft?.guestAccessToken == null &&
      /HttpOnly/i.test(guestCookieFlags) &&
      /Secure/i.test(guestCookieFlags),
    {
      hasCookie: Boolean(guestToken),
      bodyToken: guestCreate.json?.draft?.guestAccessToken ?? null,
      setCookie: guestCookieFlags.slice(0, 200),
    },
  );
  const guestAdd = await req(`/api/drafts/${guestRef}/lines`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `guest_draft_token=${guestToken}`,
    },
    body: JSON.stringify({ productId: tote.id, quantity: 1 }),
  });
  const guestReload = await req("/api/drafts", {
    headers: { cookie: `guest_draft_token=${guestToken}` },
  });
  push(
    "S2b",
    "Guest draft persists across refresh",
    guestReload.json?.draft?.draftRef === guestRef &&
      (guestReload.json?.draft?.lines?.length ?? 0) >= 1 &&
      guestAdd.json?.ok,
    { guestRef, lines: guestReload.json?.draft?.lines?.length },
  );

  // Second browser / other customer cannot open auth draft
  const other = await req(`/api/drafts/${draftRef}`, {
    headers: cookieHeader("dev_customer_2_fake"),
  });
  // Ensure fake customer doesn't get linked oddly — use staff without ownership
  const stranger = await req(`/api/drafts/${draftRef}`, {
    headers: { cookie: "dev_user_id=dev_stranger_no_access" },
  });
  push(
    "S2c",
    "Anti-enumeration: other principal cannot open customer draft",
    stranger.status === 404 && stranger.json?.ok === false,
    { status: stranger.status, otherStatus: other.status },
  );

  // Wrong guest cookie — non-staff principal
  const badGuest = await req(`/api/drafts/${guestRef}`, {
    headers: {
      cookie: "dev_user_id=dev_unrelated_browser; guest_draft_token=totally-wrong-token",
    },
  });
  push(
    "S2d",
    "Wrong guest token denied",
    badGuest.status === 404,
    { status: badGuest.status },
  );

  // Guest draft NOT cleared mid-order
  const stillThere = await req("/api/drafts", {
    headers: { cookie: `guest_draft_token=${guestToken}` },
  });
  push(
    "S2e",
    "Guest draft still present before success",
    stillThere.json?.draft?.draftRef === guestRef,
  );

  const success = await req(`/api/drafts/${guestRef}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: `guest_draft_token=${guestToken}`,
    },
    body: JSON.stringify({ action: "guest_success" }),
  });
  const afterSuccess = await req("/api/drafts", {
    headers: { cookie: `guest_draft_token=${guestToken}` },
  });
  const reopenDenied = await req(`/api/drafts/${guestRef}`, {
    headers: {
      cookie: `dev_user_id=dev_unrelated_browser; guest_draft_token=${guestToken}`,
    },
  });
  push(
    "S2f",
    "Guest draft cleared only after success",
    success.json?.cleared === true &&
      afterSuccess.json?.draft == null &&
      reopenDenied.status === 404,
    {
      cleared: success.json?.cleared,
      afterDraft: afterSuccess.json?.draft,
      reopenStatus: reopenDenied.status,
      successStatus: success.status,
      successBody: success.json,
    },
  );

  // --- S3: address edit audit ---
  const addrList = await req("/api/addresses", {
    headers: cookieHeader("dev_customer_1"),
  });
  const editTarget = addrList.json?.addresses?.find((a) => a.id === "seed-addr-customer-home");
  const custEdit = await req(`/api/addresses/${editTarget.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      recipientName: "Baseline Customer",
      line1: "100 Main Street",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
      country: "US",
      label: "Home",
      isDefault: true,
    }),
  });
  // Restore line1 for stability + prove geocode fields
  const custEditBack = await req(`/api/addresses/${editTarget.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      recipientName: "Baseline Customer",
      line1: "100 Main St",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
      country: "US",
      label: "Home",
      isDefault: true,
    }),
  });

  const ownershipFail = await req(`/api/addresses/${editTarget.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: "dev_user_id=dev_stranger_customer",
    },
    body: JSON.stringify({
      recipientName: "Hacker",
      line1: "1 Evil Ln",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
    }),
  });

  const staffEdit = await req(`/api/admin/addresses/${editTarget.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader("dev_manager_1") },
    body: JSON.stringify({
      recipientName: "Baseline Customer",
      line1: "100 Main St",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
      country: "US",
      label: "Home (staff touch)",
      isDefault: true,
    }),
  });

  const staffAudit = await db.auditLog.findFirst({
    where: { action: AuditAction.ADDRESS_STAFF_EDITED },
    orderBy: { createdAt: "desc" },
  });

  const addrRow = await db.savedAddress.findUnique({ where: { id: editTarget.id } });
  push(
    "S3a",
    "Customer edit + ownership + geocode + staff audit",
    custEdit.json?.ok &&
      custEditBack.json?.ok &&
      (ownershipFail.status === 401 || ownershipFail.status === 403 || ownershipFail.status === 404) &&
      staffEdit.json?.audited === true &&
      Boolean(staffAudit) &&
      addrRow?.geocodeStatus === "ok" &&
      addrRow?.latitude != null &&
      Boolean(addrRow?.addressNorm),
    {
      custOk: custEdit.json?.ok,
      ownershipStatus: ownershipFail.status,
      staffAudited: staffEdit.json?.audited,
      auditId: staffAudit?.id,
      geocodeStatus: addrRow?.geocodeStatus,
      lat: addrRow?.latitude,
      addressNorm: addrRow?.addressNorm,
    },
  );

  // Dedupe: upsert same address norm
  const dedupe = await req("/api/addresses", {
    method: "POST",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({
      recipientName: "Baseline Customer",
      line1: "100 Main St",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
      country: "US",
      label: "Home again",
    }),
  });
  push(
    "S3b",
    "Normalized address dedupe (update not duplicate)",
    dedupe.json?.ok && dedupe.json?.created === false && dedupe.json?.address?.id === editTarget.id,
    { created: dedupe.json?.created, addressId: dedupe.json?.address?.id },
  );

  // Account area
  const account = await req("/api/account", {
    headers: cookieHeader("dev_customer_1"),
  });
  const accountPage = await req("/account", { headers: cookieHeader("dev_customer_1") });
  push(
    "S3c",
    "Account dashboard + drafts + addresses",
    account.json?.ok &&
      account.json?.drafts?.length >= 1 &&
      account.json?.addresses?.length >= 2 &&
      accountPage.text.includes("account-dashboard"),
    {
      drafts: account.json?.drafts?.length,
      addresses: account.json?.addresses?.length,
    },
  );

  const pos = await req("/admin/pos", { headers: cookieHeader("dev_manager_1") });
  push(
    "S3d",
    "Shared POS builder shell",
    pos.status === 200 && pos.text.includes("pos-builder") && pos.text.includes("order-builder"),
    { status: pos.status },
  );

  // Cleanup auth smoke draft
  await req(`/api/drafts/${draftRef}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...cookieHeader("dev_customer_1") },
    body: JSON.stringify({ action: "cancel" }),
  });

  const passed = evidence.filter((e) => e.pass).length;
  const failed = evidence.filter((e) => !e.pass);
  const summary = {
    ok: failed.length === 0,
    passed,
    total: evidence.length,
    failed: failed.map((f) => f.id),
    evidence,
  };

  const scratch = path.join(process.cwd(), ".scratch");
  await mkdir(scratch, { recursive: true });
  const smokePath = path.join(scratch, "PHASE-P4-SMOKE.md");
  const statusPath = path.join(scratch, "PHASE-P4-STATUS.md");
  const body = [
    "# PHASE-P4 smoke evidence",
    "",
    `Run at: ${new Date().toISOString()}`,
    `Base: ${base}`,
    `Result: ${summary.ok ? "PASS" : "FAIL"} (${passed}/${evidence.length})`,
    "",
    "| ID | Check | Pass |",
    "|---|---|---|",
    ...evidence.map((e) => `| ${e.id} | ${e.check} | ${e.pass ? "PASS" : "FAIL"} |`),
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
  ].join("\n");
  await writeFile(smokePath, body, "utf8");
  await writeFile(
    statusPath,
    [
      "# PHASE-P4 status",
      "",
      `- Smoke: ${summary.ok ? "PASS" : "FAIL"} (${passed}/${evidence.length})`,
      `- Evidence: workspace/.scratch/PHASE-P4-SMOKE.md`,
      `- Delivered: cart-first builder, address book, guest tokens, account area, shared POS shell`,
      `- Out of scope held: payment/Stripe (P5), repeat orders (P10)`,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify({ ok: summary.ok, passed, total: evidence.length, failed: summary.failed }, null, 2));
  if (!summary.ok) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
