// Domain checks for P10: replacement chains across seasons, the repeat plan
// (auto map, price-smart suggestions, greeting prefill), confirm→draft with
// lineage, staff one-click upgrade, bulk history idempotency, the season
// wizard + manager flip + cron auto-flip, and the legacy import hook.

import { PrismaClient } from "@prisma/client";
import { saveDraft } from "../lib/orders/drafts";
import { repeatOrder } from "../lib/orders/repeat";
import { resolveReplacementChain } from "../lib/repeat/chain";
import { suggestByPrice } from "../lib/repeat/matcher";
import { buildRepeatPlan } from "../lib/repeat/plan";
import { createDraftFromRepeat, autoConfirmPlan } from "../lib/repeat/create";
import { listBulkHistoryCandidates, runBulkHistory } from "../lib/repeat/bulk-history";
import { createSeasonWizard, setSeasonStatus, runSeasonFlip } from "../lib/seasons/manage";
import { importLegacyOrders } from "../lib/repeat/import-hook";
import { getOpenSeason } from "../lib/seasons/queries";
import { closeAllOpenSeasons, expectThrow, reopenSeasons } from "./test-db-helpers.mts";
import { DomainRuleError } from "../lib/errors";

const prisma = new PrismaClient();
let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

const previouslyOpen = await closeAllOpenSeasons(prisma);
const stamp = Date.now();

// --- fixture: 2025 → 2026 → 2027 chain, one dead end ------------------------------
const s2025 = await prisma.season.create({ data: { name: `TEST-P10-2025-${stamp}`, status: "CLOSED" } });
const s2026 = await prisma.season.create({ data: { name: `TEST-P10-2026-${stamp}`, status: "CLOSED" } });
const s2027 = await prisma.season.create({ data: { name: `TEST-P10-2027-${stamp}`, status: "OPEN" } });

const staff = await prisma.staffUser.create({
  data: {
    email: `p10-staff-${stamp}@example.org`,
    name: "P10 Staff",
    role: "MANAGER",
    status: "ACTIVE",
    confirmedAt: new Date(),
  },
});
const ctx = { staff: { id: staff.id, email: staff.email }, impersonator: null };

const customer = await prisma.customer.create({
  data: {
    email: `p10-${stamp}@example.org`,
    name: "P10 Customer",
    phone: `732-555-${String(stamp).slice(-4)}`,
    normalizedPhone: `73256${String(stamp).slice(-6)}`,
  },
});
const bookAddress = await prisma.address.create({
  data: {
    customerId: customer.id,
    label: "Bubby",
    line1: "9 Hilltop Rd",
    city: "Lakewood",
    region: "NJ",
    postalCode: "08701",
    country: "US",
    lastGreeting: "From the Cohens",
  },
});

const newBasket = await prisma.product.create({
  data: { slug: `p10-new-basket-${stamp}`, name: "New Basket", basePriceCents: 2000, seasonId: s2027.id, category: "baskets" },
});
const midBasket = await prisma.product.create({
  data: {
    slug: `p10-mid-basket-${stamp}`,
    name: "Mid Basket",
    basePriceCents: 1900,
    seasonId: s2026.id,
    category: "baskets",
    active: false,
    replacedById: newBasket.id,
  },
});
const oldBasket = await prisma.product.create({
  data: {
    slug: `p10-old-basket-${stamp}`,
    name: "Old Basket",
    basePriceCents: 1800,
    seasonId: s2025.id,
    category: "baskets",
    active: false,
    replacedById: midBasket.id,
  },
});
const deadCandy = await prisma.product.create({
  data: { slug: `p10-dead-candy-${stamp}`, name: "Dead Candy", basePriceCents: 500, seasonId: s2025.id, category: "candy", active: false },
});
const shalachTrio = await prisma.product.create({
  data: { slug: `p10-trio-${stamp}`, name: "Shalach Trio", basePriceCents: 550, seasonId: s2027.id, category: "candy" },
});
const megillahCard = await prisma.product.create({
  data: { slug: `p10-card-${stamp}`, name: "Megillah Card", basePriceCents: 300, seasonId: s2027.id, category: "cards" },
});
const fancy2027 = await prisma.product.create({
  data: {
    slug: `p10-fancy-27-${stamp}`,
    name: "Fancy Box",
    basePriceCents: 3000,
    seasonId: s2027.id,
    options: { create: [{ name: "Size", values: { create: [{ label: "Large", priceDeltaCents: 400 }] } }] },
  },
});
const fancy2025 = await prisma.product.create({
  data: {
    slug: `p10-fancy-25-${stamp}`,
    name: "Fancy Box",
    basePriceCents: 2800,
    seasonId: s2025.id,
    active: false,
    replacedById: fancy2027.id,
    options: { create: [{ name: "Size", values: { create: [{ label: "Large", priceDeltaCents: 300 }] } }] },
  },
});

// --- chain resolution ---------------------------------------------------------------
const chain = await resolveReplacementChain(oldBasket.id, s2027.id);
check(
  "chain walks 2025 → 2026 → 2027 and lands on New Basket",
  chain.final?.id === newBasket.id && chain.hops.length === 2 && !chain.deadEnd,
);
const deadChain = await resolveReplacementChain(deadCandy.id, s2027.id);
check("an unmapped discontinued product is a dead end", deadChain.final === null && deadChain.deadEnd);
const sameSeason = await resolveReplacementChain(newBasket.id, s2027.id);
check("a live product in the target season resolves to itself", sameSeason.final?.id === newBasket.id && sameSeason.hops.length === 0);
const inactive = await prisma.product.create({
  data: { slug: `p10-inactive-${stamp}`, name: "Shelved", basePriceCents: 100, seasonId: s2027.id, active: false },
});
check(
  "an inactive product in the target season is a dead end",
  (await resolveReplacementChain(inactive.id, s2027.id)).deadEnd,
);

// --- price-smart suggestions -----------------------------------------------------------
const suggestions = await suggestByPrice(deadCandy.id, s2027.id);
check(
  "suggestions prefer the same category, then closest price",
  suggestions.length > 0 && suggestions[0].productId === shalachTrio.id,
);
check(
  "suggestions carry signed deltas and skip inactive products",
  suggestions.every((s) => s.productId !== inactive.id) &&
    suggestions.find((s) => s.productId === shalachTrio.id)?.priceDeltaCents === 50,
);

// --- repeat plan -------------------------------------------------------------------------
const fancyOption = await prisma.productOptionValue.findFirstOrThrow({
  where: { option: { productId: fancy2025.id }, label: "Large" },
});
const sourceOrder = await prisma.order.create({
  data: {
    seasonId: s2025.id,
    customerId: customer.id,
    status: "FINALIZED",
    paymentStatus: "PAID",
    orderNumber: 91001,
    totalCents: 5400,
    lines: {
      create: [
        { productId: oldBasket.id, productName: "Old Basket", qty: 1, unitPriceCents: 1800, lineTotalCents: 1800 },
        { productId: deadCandy.id, productName: "Dead Candy", qty: 2, unitPriceCents: 500, lineTotalCents: 1000 },
        {
          productId: fancy2025.id,
          productName: "Fancy Box",
          qty: 1,
          unitPriceCents: 2800,
          optionValueId: fancyOption.id,
          optionLabel: "Size: Large",
          optionPriceDeltaCents: 300,
          lineTotalCents: 3100,
        },
      ],
    },
    recipients: {
      create: [
        {
          name: "Bubby",
          line1: "9 Hilltop Rd",
          city: "Lakewood",
          region: "NJ",
          postalCode: "08701",
          addressId: bookAddress.id,
          greeting: "Old greeting",
        },
        { name: "Zeidy", line1: "1 Main St", city: "Monsey", region: "NY", postalCode: "10952", greeting: "Happy Purim Zeidy" },
      ],
    },
  },
  include: { lines: true, recipients: true },
});
// Assign Bubby the first two lines so recipient mapping is exercised.
for (const line of sourceOrder.lines.slice(0, 2)) {
  await prisma.orderLine.update({ where: { id: line.id }, data: { recipientId: sourceOrder.recipients[0].id } });
}

const plan = await buildRepeatPlan(sourceOrder.id);
const planBasket = plan.lines.find((line) => line.sourceName === "Old Basket");
const planCandy = plan.lines.find((line) => line.sourceName === "Dead Candy");
const planFancy = plan.lines.find((line) => line.sourceName === "Fancy Box");
check(
  "plan auto-maps the chained line and notes the new price",
  planBasket?.status === "auto" && planBasket.targetProductId === newBasket.id && planBasket.notes.some((n) => n.includes("$20.00")),
);
check(
  "plan flags the dead line with price-smart suggestions",
  planCandy?.status === "unmapped" && (planCandy.suggestions?.[0]?.productId ?? null) === shalachTrio.id,
);
check(
  "plan re-maps the option onto the replacement by name",
  planFancy?.status === "auto" && planFancy.optionLabel === "Size: Large" && planFancy.optionValueId !== fancyOption.id,
);
const planBubby = plan.recipients.find((r) => r.name === "Bubby");
const planZeidy = plan.recipients.find((r) => r.name === "Zeidy");
check(
  "book-matched recipient keeps the link and the BOOK greeting wins (G-012)",
  planBubby?.matchedAddressId === bookAddress.id && planBubby.greeting === "From the Cohens",
);
check(
  "unmatched recipient keeps the source greeting",
  planZeidy?.matchedAddressId === null && planZeidy.greeting === "Happy Purim Zeidy",
);
check("plan reports the unmapped count", plan.unmappedCount === 1);

// --- confirm → draft ----------------------------------------------------------------------
const { draft, summary } = await createDraftFromRepeat({
  sourceOrderId: sourceOrder.id,
  lines: [
    { sourceLineId: planBasket!.sourceLineId, action: "keep" },
    { sourceLineId: planCandy!.sourceLineId, action: "swap", targetProductId: shalachTrio.id },
    { sourceLineId: planFancy!.sourceLineId, action: "remove" },
  ],
  recipients: plan.recipients.map((r) => ({ sourceRecipientId: r.sourceRecipientId, action: "keep" as const })),
});
const draftFull = await prisma.order.findUniqueOrThrow({
  where: { id: draft.id },
  include: { lines: true, recipients: true },
});
check(
  "confirm mints a draft in the OPEN season with repeat lineage",
  draftFull.seasonId === s2027.id && draftFull.status === "DRAFT" && draftFull.repeatedFromOrderId === sourceOrder.id,
);
check(
  "draft lines are the kept chain target + the swap, at CURRENT prices",
  draftFull.lines.length === 2 &&
    draftFull.lines.some((line) => line.productId === newBasket.id && line.unitPriceCents === 2000) &&
    draftFull.lines.some((line) => line.productId === shalachTrio.id && line.unitPriceCents === 550),
);
check(
  "draft recipients carry greetings and the book link",
  draftFull.recipients.some((r) => r.name === "Bubby" && r.greeting === "From the Cohens" && r.addressId === bookAddress.id) &&
    draftFull.recipients.some((r) => r.name === "Zeidy" && r.greeting === "Happy Purim Zeidy"),
);
check(
  "summary reports keep/swap/remove",
  summary.kept.includes("Old Basket") &&
    summary.swapped.some((s) => s.from === "Dead Candy" && s.to === "Shalach Trio") &&
    summary.removed.includes("Fancy Box"),
);

// --- staff one-click upgrade (P6 path, now chain-aware) ------------------------------------
const inSeasonOrder = await prisma.order.create({
  data: {
    seasonId: s2027.id,
    customerId: customer.id,
    status: "FINALIZED",
    orderNumber: 91002,
    lines: { create: [{ productId: newBasket.id, productName: "New Basket", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 }] },
  },
});
const oneClick = await repeatOrder(inSeasonOrder.id);
check(
  "one-click repeat still works for in-season orders",
  oneClick.draftRef.startsWith("D-") && oneClick.skipped.length === 0,
);
const deadOnly = await prisma.order.create({
  data: {
    seasonId: s2025.id,
    customerId: customer.id,
    status: "FINALIZED",
    orderNumber: 91003,
    lines: { create: [{ productId: deadCandy.id, productName: "Dead Candy", qty: 1, unitPriceCents: 500, lineTotalCents: 500 }] },
  },
});
check(
  "one-click repeat of a fully dead order refuses (nothing to repeat)",
  await expectThrow(() => repeatOrder(deadOnly.id), DomainRuleError),
);

// --- bulk history (idempotent) --------------------------------------------------------------
// Dedicated source order: the confirm test above already left a repeat draft
// for sourceOrder, which would (correctly) make it "already repeated" here.
const bulkOrder = await prisma.order.create({
  data: {
    seasonId: s2025.id,
    customerId: customer.id,
    status: "FINALIZED",
    paymentStatus: "PAID",
    orderNumber: 91004,
    totalCents: 2300,
    lines: {
      create: [
        { productId: oldBasket.id, productName: "Old Basket", qty: 1, unitPriceCents: 1800, lineTotalCents: 1800 },
        { productId: deadCandy.id, productName: "Dead Candy", qty: 1, unitPriceCents: 500, lineTotalCents: 500 },
      ],
    },
  },
});
const candidates = await listBulkHistoryCandidates({ sourceSeasonId: s2025.id });
check(
  "bulk candidates list the 2025 finalized orders as not-yet-repeated",
  candidates.rows.some((row) => row.orderId === bulkOrder.id && !row.alreadyRepeated),
);
const firstRun = await runBulkHistory({ orderIds: [bulkOrder.id, deadOnly.id], ctx });
check(
  "first bulk run repeats the mapped order and skips the fully dead one",
  firstRun.counts.succeeded === 1 && firstRun.counts.skipped === 1 &&
    firstRun.results.find((r) => r.orderId === bulkOrder.id)?.outcome === "repeated",
);
check(
  "the bulk draft carries repeat lineage and drops the dead line with a reason",
  (await prisma.order.count({ where: { repeatedFromOrderId: bulkOrder.id, seasonId: s2027.id, status: "DRAFT" } })) === 1 &&
    firstRun.results.find((r) => r.orderId === bulkOrder.id)?.reason?.includes("1 discontinued") === true,
);
const secondRun = await runBulkHistory({ orderIds: [bulkOrder.id], ctx });
check(
  "second bulk run is a skip, never a double draft (idempotency)",
  secondRun.counts.succeeded === 0 && secondRun.results[0].reason?.includes("already repeated"),
);
check(
  "candidates now mark the order as already repeated",
  (await listBulkHistoryCandidates({ sourceSeasonId: s2025.id })).rows.find((row) => row.orderId === bulkOrder.id)
    ?.alreadyRepeated === true,
);
check(
  "bulk history wrote the audit row",
  (await prisma.auditLog.count({ where: { action: "repeat_bulk_history", targetId: s2027.id } })) >= 1,
);
check(
  "bulk history refuses open-season sources (that's P6 bulk repeat)",
  (await runBulkHistory({ orderIds: [inSeasonOrder.id], ctx })).results[0].reason?.includes("open season") === true,
);

// --- legacy import hook (runs while s2027's catalog is still the open one) ----
const legacy = await importLegacyOrders(
  [
    {
      customerEmail: customer.email,
      customerName: customer.name,
      year: 2024,
      externalKey: `row-1-${stamp}`,
      recipients: [
        { name: "Bubby", line1: "9 Hilltop Rd", city: "Lakewood", region: "NJ", postalCode: "08701", greeting: "Legacy love" },
      ],
      lines: [{ productName: `Unknown Legacy Basket ${stamp}`, qty: 1, recipientName: "Bubby" }],
    },
  ],
  { ctx },
);
check("legacy import creates the order", legacy.created === 1 && legacy.skipped.length === 0);
const legacyOrder = await prisma.order.findFirstOrThrow({
  where: { wireFormat: `legacy-import:2024:row-1-${stamp}` },
  include: { lines: true, recipients: true },
});
check(
  "unknown legacy products become inactive stubs in a Legacy season",
  legacyOrder.lines.length === 1 && legacyOrder.recipients.length === 1 &&
    (await prisma.product.findUniqueOrThrow({ where: { id: legacyOrder.lines[0].productId! } })).active === false,
);
const legacyPlan = await buildRepeatPlan(legacyOrder.id);
check(
  "imported order builds a repeat plan: stub is unmapped with suggestions, greeting resolves",
  legacyPlan.lines[0].status === "unmapped" &&
    (legacyPlan.lines[0].suggestions?.length ?? 0) > 0 &&
    legacyPlan.recipients[0].greeting === "From the Cohens",
);
const reimport = await importLegacyOrders(
  [
    {
      customerEmail: customer.email,
      year: 2024,
      externalKey: `row-1-${stamp}`,
      recipients: [{ name: "Bubby", line1: "9 Hilltop Rd", city: "Lakewood", region: "NJ", postalCode: "08701" }],
      lines: [{ productName: `Unknown Legacy Basket ${stamp}`, qty: 1 }],
    },
  ],
  { ctx },
);
check("re-import of the same external key is a skip, not a dupe", reimport.created === 0 && reimport.skipped.length === 1);

// --- season wizard + manager flip --------------------------------------------------------------
const wizard = await createSeasonWizard({
  name: `TEST-P10-2028-${stamp}`,
  copyCatalogFromSeasonId: s2027.id,
  scheduledOpensAt: new Date(Date.now() + 86400_000),
  ctx,
});
const wizardSeason = await prisma.season.findUniqueOrThrow({ where: { id: wizard.seasonId }, include: { products: true } });
check("wizard season is born CLOSED with the full catalog copy", wizardSeason.status === "CLOSED" && wizard.copiedProducts === 5);
check(
  "wizard copied products with fresh year-suffixed slugs and no replacement back-links",
  wizardSeason.products.length === 5 &&
    wizardSeason.products.every((p) => p.replacedById === null) &&
    wizardSeason.products.some((p) => p.slug.startsWith(`p10-new-basket-${stamp}`) && p.slug.endsWith(`-${getYear()}`)),
);
check(
  "duplicate season name refuses",
  await expectThrow(
    () => createSeasonWizard({ name: `TEST-P10-2028-${stamp}`, ctx }),
    DomainRuleError,
  ),
);
const flip = await setSeasonStatus({ seasonId: wizard.seasonId, status: "OPEN", ctx });
check(
  "opening the wizard season auto-closes 2027 (single-open flip)",
  flip.flippedFrom === s2027.name &&
    (await prisma.season.findUniqueOrThrow({ where: { id: s2027.id } })).status === "CLOSED",
);
check(
  "exactly one season is open after the flip",
  (await prisma.season.count({ where: { status: "OPEN" } })) === 1 &&
    (await getOpenSeason())?.id === wizard.seasonId,
);

// --- cron auto-flip ------------------------------------------------------------------------------
// Single-open invariant: close the wizard season before creating another OPEN row.
await prisma.season.update({ where: { id: wizard.seasonId }, data: { status: "CLOSED" } });
const flipSeasonA = await prisma.season.create({
  data: {
    name: `TEST-P10-FLIP-OLD-${stamp}`,
    status: "OPEN",
    scheduledClosesAt: new Date(Date.now() - 60_000),
  },
});
const flipSeasonB = await prisma.season.create({
  data: {
    name: `TEST-P10-FLIP-NEW-${stamp}`,
    status: "CLOSED",
    scheduledOpensAt: new Date(Date.now() - 60_000),
  },
});
const flipResult = await runSeasonFlip();
check(
  "cron flip closes the due season and opens the scheduled one",
  flipResult.closed.includes(flipSeasonA.name) && flipResult.opened.includes(flipSeasonB.name) &&
    (await prisma.season.findUniqueOrThrow({ where: { id: flipSeasonB.id } })).status === "OPEN",
);
check(
  "the flip left a CronRun row",
  (await prisma.cronRun.count({ where: { name: "season-flip", status: "OK" } })) >= 1,
);
const idleFlip = await runSeasonFlip();
check("a second flip with nothing due is a no-op", idleFlip.closed.length === 0 && idleFlip.opened.length === 0);

// --- saveDraft greeting passthrough -----------------------------------------------------------------------
const greetDraft = await saveDraft({
  seasonId: flipSeasonB.id,
  customerId: customer.id,
  lines: [{ productId: newBasket.id, qty: 1, recipientClientId: "r1" }],
  recipients: [
    {
      clientId: "r1",
      name: "Bubby",
      line1: "9 Hilltop Rd",
      city: "Lakewood",
      region: "NJ",
      postalCode: "08701",
      greeting: "Passthrough greeting",
    },
  ],
  allowBookWrites: false,
});
check(
  "saveDraft persists recipient greetings",
  greetDraft.recipients[0]?.greeting === "Passthrough greeting",
);

function getYear(): number {
  return new Date().getMonth() >= 3 ? new Date().getFullYear() + 1 : new Date().getFullYear();
}

// Close OUR open seasons before restoring the originals — the single-open
// partial index rejects reopening while a test season is still open.
await closeAllOpenSeasons(prisma);
await reopenSeasons(prisma, previouslyOpen);
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} P10 domain check(s) failed`);
  process.exit(1);
}
console.log("P10 domain checks passed");
