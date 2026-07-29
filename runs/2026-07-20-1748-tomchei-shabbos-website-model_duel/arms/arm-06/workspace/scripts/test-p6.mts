// Unit checks for P6 pure helpers: CSV parse/serialize round-trip, order-list
// + customer-directory param parsing and where-builders, the repeat planner,
// and both import row parsers. DB-backed P6 behavior (imports commit, bulk
// actions, POS checkout, refund, dashboard, scale) lives in test-p6-domain.mts.

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:4106/app";
process.env.AUTH_SECRET ??= "0123456789abcdef0123456789abcdef";

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

// --- CSV engine ---------------------------------------------------------------
const { parseCsv, toCsv } = await import("../lib/csv");

check("empty input parses to zero rows", parseCsv("").length === 0);
check(
  "simple rows split on commas and newlines",
  JSON.stringify(parseCsv("a,b,c\nd,e,f")) === JSON.stringify([["a", "b", "c"], ["d", "e", "f"]]),
);
check(
  "quoted field keeps commas, quotes, and newlines",
  JSON.stringify(parseCsv('"a,""b","x\ny",z')) === JSON.stringify([['a,"b', "x\ny", "z"]]),
);
check(
  "CRLF line endings parse like LF",
  JSON.stringify(parseCsv("a,b\r\nc,d\r\n")) === JSON.stringify([["a", "b"], ["c", "d"]]),
);
check("trailing newline does not add a phantom row", parseCsv("a,b\n").length === 1);

const roundTripRows = [
  ["name", "email", "note"],
  ["Kohn, Menny", "m@example.org", 'said "hi"\nthen left'],
  ["", "", ""],
];
const roundTripped = parseCsv(toCsv(roundTripRows));
check(
  "toCsv → parseCsv round-trips hostile cells",
  JSON.stringify(roundTripped.slice(0, 3)) === JSON.stringify(roundTripRows),
);

// --- order list params + where -------------------------------------------------
const {
  buildOrderWhere,
  clampPage,
  pageCount,
  parseOrderListParams,
  parsePageSize,
  DEFAULT_PAGE_SIZE,
} = await import("../lib/admin/order-list");

const defaults = parseOrderListParams({});
check(
  "defaults: no filters, page 1, default size",
  defaults.q === null && defaults.status === null && defaults.payment === null
    && defaults.page === 1 && defaults.pageSize === DEFAULT_PAGE_SIZE,
);
const parsed = parseOrderListParams({ q: "  kohn ", status: "FINALIZED", payment: "NOPE", page: "3", size: "50" });
check(
  "valid filters parse, invalid enum drops, q trims",
  parsed.q === "kohn" && parsed.status === "FINALIZED" && parsed.payment === null
    && parsed.page === 3 && parsed.pageSize === 50,
);
check("page clamps to >= 1", parseOrderListParams({ page: "-4" }).page === 1);
check("page size allowlist: unknown falls back", parsePageSize("13") === DEFAULT_PAGE_SIZE);
check("pageCount rounds up with floor 1", pageCount(0, 25) === 1 && pageCount(26, 25) === 2);
check("clampPage pins into range", clampPage(9, 26, 25) === 2 && clampPage(0, 26, 25) === 1);

const whereAll = buildOrderWhere("season-1", defaults) as Record<string, unknown>;
check("where without filters scopes to the season only", whereAll.seasonId === "season-1" && !("OR" in whereAll));

const whereNumeric = buildOrderWhere("season-1", { ...defaults, q: "42" }) as { OR: Record<string, unknown>[] };
check(
  "numeric q adds the orderNumber branch",
  whereNumeric.OR.some((branch) => (branch as { orderNumber?: number }).orderNumber === 42),
);
const whereText = buildOrderWhere("season-1", { ...defaults, q: "MM-2026" }) as { OR: Record<string, unknown>[] };
check(
  "text q searches wire format, draft ref, and customer — no numeric branch",
  whereText.OR.every((branch) => !("orderNumber" in branch)) && whereText.OR.length === 4,
);
const whereFilters = buildOrderWhere("season-1", {
  ...defaults,
  status: "DRAFT",
  payment: "PARTIAL",
}) as Record<string, unknown>;
check("status + payment filters land on the where", whereFilters.status === "DRAFT" && whereFilters.paymentStatus === "PARTIAL");

// --- customer directory ---------------------------------------------------------
const { buildCustomerWhere, parseCustomerListParams } = await import("../lib/customers/directory");

const custDefaults = parseCustomerListParams({});
check("directory defaults: no query, page 1", custDefaults.q === null && custDefaults.page === 1);
check(
  "directory query trims; empty becomes null",
  parseCustomerListParams({ q: "  rivka " }).q === "rivka" && parseCustomerListParams({ q: "   " }).q === null,
);
const custWhere = buildCustomerWhere("rivka") as { OR: unknown[] };
check("directory where matches name/email/phone", custWhere.OR.length === 3);
check("directory where without query is empty", Object.keys(buildCustomerWhere(null)).length === 0);

// --- repeat planner ----------------------------------------------------------------
const { planRepeat } = await import("../lib/orders/repeat");

const repeatOrderRow = {
  id: "order-1",
  lines: [
    { id: "l1", productId: "p-live", addOnId: null, parentLineId: null, optionValueId: "ov-1", qty: 2, productName: "Live Box", recipientId: "r1" },
    { id: "l1a", productId: null, addOnId: "a-live", parentLineId: "l1", optionValueId: null, qty: 2, productName: "Ribbon", recipientId: null },
    { id: "l2", productId: "p-dead", addOnId: null, parentLineId: null, optionValueId: null, qty: 1, productName: "Gone Box", recipientId: "r2" },
    { id: "l2a", productId: null, addOnId: "a-live", parentLineId: "l2", optionValueId: null, qty: 1, productName: "Ribbon", recipientId: null },
    { id: "l3", productId: "p-live", addOnId: null, parentLineId: null, optionValueId: "ov-gone", qty: 1, productName: "Live Box", recipientId: null },
    { id: "l4", productId: null, addOnId: "a-dead", parentLineId: null, optionValueId: null, qty: 1, productName: "Old Ribbon", recipientId: null },
  ],
  recipients: [
    { id: "r1", name: "Bubby", line1: "9 Hilltop Rd", line2: null, city: "Lakewood", region: "NJ", postalCode: "08701", country: "US" },
    { id: "r2", name: "Aunt Miriam", line1: "40 Faraway Ln", line2: "Apt 2", city: "Monsey", region: "NY", postalCode: "10952", country: "US" },
  ],
} as unknown as import("../lib/orders/drafts").DraftWithContents;

const plan = planRepeat(repeatOrderRow, {
  productIds: new Set(["p-live"]),
  optionValueIds: new Set(["ov-1"]),
  addOnIds: new Set(["a-live"]),
});

const keptL1 = plan.lines.find((line) => line.productId === "p-live" && line.recipientClientId === "r1");
check("repeat keeps live product lines", keptL1 !== undefined && keptL1.optionValueId === "ov-1");
check(
  "kept lines get FRESH ids (old ids are rows in the source order)",
  plan.lines.every((line) => line.id === undefined || !repeatOrderRow.lines.some((old) => old.id === line.id)),
);
check(
  "kept add-on re-points at its parent's fresh id",
  plan.lines.some((line) => line.addOnId === "a-live" && line.parentLineId === keptL1?.id),
);
check(
  "repeat skips the dead product AND its add-on child (one reason)",
  plan.skipped.filter((skip) => skip.productName === "Gone Box").length === 1
    && plan.lines.filter((line) => line.addOnId === "a-live").length === 1,
);
check(
  "repeat skips a line whose option is gone, with its own reason",
  plan.skipped.some((skip) => skip.reason.includes("option")),
);
check("repeat skips a dead add-on", plan.skipped.some((skip) => skip.productName === "Old Ribbon"));
check(
  "repeat maps recipients one-to-one and never re-links the book",
  plan.recipients.length === 2
    && plan.recipients.every((recipient) => recipient.saveToBook === false)
    && plan.recipients[0].clientId === "r1",
);
check(
  "empty catalog skips everything",
  planRepeat(repeatOrderRow, { productIds: new Set(), optionValueIds: new Set(), addOnIds: new Set() }).lines.length === 0,
);

// --- import row parsers ---------------------------------------------------------
const { customersImport } = await import("../lib/imports/customers");
const { productsImport } = await import("../lib/imports/products");

const custOk = customersImport.parseRow(1, { name: "  Rivka Kohn ", email: "Rivka@Example.ORG ", phone: "(732) 555-1212" });
check(
  "customer row normalizes name + email, keeps phone",
  custOk.verdict === "valid" && custOk.data.name === "Rivka Kohn" && custOk.data.email === "rivka@example.org",
);
check("customer row without a name is invalid", customersImport.parseRow(2, { name: "", email: "a@b.co" }).verdict === "invalid");
check(
  "customer row with a broken email is invalid",
  customersImport.parseRow(3, { name: "X", email: "not-an-email" }).verdict === "invalid",
);
const custKeys = customersImport.duplicateKeys(custOk.data);
check(
  "customer dedupe keys cover the normalized email and phone",
  JSON.stringify(custKeys) === JSON.stringify([
    { key: "email:rivka@example.org", label: "email" },
    { key: "phone:+17325551212", label: "phone" },
  ]),
);
check(
  "a phoneless customer row dedupes on email only",
  customersImport.duplicateKeys({ name: "X", email: "x@y.co", phone: null }).length === 1,
);

const prodOk = productsImport.parseRow(1, { name: "Deluxe Box", price: "42.50", active: "no", description: "", category: "Boxes" });
check(
  "product row derives slug, parses price and active=false",
  prodOk.verdict === "valid" && prodOk.data.slug === "deluxe-box" && prodOk.data.priceCents === 4250 && prodOk.data.active === false,
);
check("product row defaults active=true", productsImport.parseRow(2, { name: "X", price: "1" }).data.active === true);
check("product row with a dirty price is invalid", productsImport.parseRow(3, { name: "X", price: "1.234" }).verdict === "invalid");
check("product row with junk active is invalid", productsImport.parseRow(4, { name: "X", price: "1", active: "maybe" }).verdict === "invalid");
check(
  "product dedupe key is the derived slug",
  JSON.stringify(productsImport.duplicateKeys(prodOk.data)) === JSON.stringify([{ key: "slug:deluxe-box", label: "slug" }]),
);

if (failures > 0) {
  console.error(`${failures} P6 check(s) failed`);
  process.exit(1);
}
console.log("All P6 checks passed");
