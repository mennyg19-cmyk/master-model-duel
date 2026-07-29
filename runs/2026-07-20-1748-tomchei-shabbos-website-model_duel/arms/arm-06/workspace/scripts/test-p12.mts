// Unit checks for P12 pure helpers: legacy-export normalization (R-186/G-029),
// the near-duplicate address group key (UR-014), and the legacy handlers'
// parseRow verdicts (bad rows fail at STAGE, before anything touches the DB).
// DB-backed P12 behavior (dry-run guard, atomic commits, address cleanup,
// reconciliation matcher, exports, reports) lives in test-p12-domain.mts.

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

const { titleCaseName, normalizeRegion, normalizeZip, legacyAddressGroupKey } = await import(
  "../lib/imports/legacy/normalize"
);
const { legacyCustomersImport } = await import("../lib/imports/legacy/customers");
const { legacyProductsImport } = await import("../lib/imports/legacy/products");
const { legacyOrdersImport } = await import("../lib/imports/legacy/orders");

// --- normalization -----------------------------------------------------------
check("titleCaseName repairs shouting + collapsed whitespace", titleCaseName("JOHN  DOE") === "John Doe");
check("titleCaseName keeps apostrophe/hyphen capitals", titleCaseName("o'brien-smith") === "O'Brien-Smith");
check("normalizeRegion uppercases two-letter codes", normalizeRegion("ny") === "NY");
check("normalizeRegion title-cases full state names", normalizeRegion("  new jersey ") === "New Jersey");
check("normalizeZip takes 5-digit", normalizeZip("08701") === "08701");
check("normalizeZip glues bare 9-digit to 5+4", normalizeZip("087011234") === "08701-1234");
check("normalizeZip keeps hyphenated 5+4", normalizeZip("08701-1234") === "08701-1234");
check("normalizeZip rejects short/garbage honestly", normalizeZip("0870") === null && normalizeZip("see note") === null);

// --- near-duplicate group key (UR-014) ---------------------------------------
const keyA = legacyAddressGroupKey({ line1: "123 Main St.", city: "Lakewood", postalCode: "08701-1234" });
const keyB = legacyAddressGroupKey({ line1: "123 main st", city: "LAKEWOOD", postalCode: "08701" });
const keyC = legacyAddressGroupKey({ line1: "123 Main St.", city: "Lakewood", postalCode: "08702" });
check("group key collapses punctuation/case drift and zip+4", keyA === keyB);
check("group key separates different ZIP-5s", keyA !== keyC);

// --- legacy customers parseRow ------------------------------------------------
const baseCustomer = {
  customer_name: "rivky WEISS",
  email: "Rivky@Example.org",
  phone: "(732) 555-0142",
  address_label: "home",
  line1: "12 Hadassah Ln",
  city: "lakewood",
  region: "nj",
  postal_code: "08701",
};
const validCustomer = legacyCustomersImport.parseRow(1, { ...baseCustomer });
check("a good legacy customer row stages valid with normalization applied",
  validCustomer.verdict === "valid" &&
    (validCustomer.data as { customerName: string }).customerName === "Rivky Weiss" &&
    (validCustomer.data as { email: string }).email === "rivky@example.org");
check("a row with no name is invalid at parse",
  legacyCustomersImport.parseRow(2, { ...baseCustomer, customer_name: "" }).verdict === "invalid");
check("a malformed email is invalid at parse",
  legacyCustomersImport.parseRow(3, { ...baseCustomer, email: "not-an-email" }).verdict === "invalid");
check("a row with neither email nor phone is invalid at parse",
  legacyCustomersImport.parseRow(4, { ...baseCustomer, email: "", phone: "" }).verdict === "invalid");
const badZip = legacyCustomersImport.parseRow(5, { ...baseCustomer, postal_code: "call me" });
check("an unparseable ZIP still stages valid but flagged for review (G-029)",
  badZip.verdict === "valid" && (badZip.data as { addressNeedsReview: string | null }).addressNeedsReview !== null);
check("a partial address (no line1) is invalid",
  legacyCustomersImport.parseRow(6, { ...baseCustomer, line1: "" }).verdict === "invalid");

// --- legacy products parseRow -------------------------------------------------
const goodProduct = legacyProductsImport.parseRow(1, {
  year: "2024",
  product_name: "SHABBOS box",
  price: "$47.85",
  product_type: "box",
  size_text: "large",
});
check("a good legacy product row stages valid with cents + slug",
  goodProduct.verdict === "valid" &&
    (goodProduct.data as { priceCents: number }).priceCents === 4785 &&
    (goodProduct.data as { slug: string }).slug === "legacy-2024-shabbos-box");
check("a 3-digit year is invalid",
  legacyProductsImport.parseRow(2, { year: "999", product_name: "Box", price: "1" }).verdict === "invalid");
check("a negative price is invalid",
  legacyProductsImport.parseRow(3, { year: "2024", product_name: "Box", price: "-5" }).verdict === "invalid");

// --- legacy orders parseRow ---------------------------------------------------
const baseOrder = {
  legacy_order_no: "LG-9001",
  order_date: "2024-02-12",
  email: "buyer@example.org",
  phone: "",
  customer_name: "Buyer",
  item_name: "shabbos box",
  item_qty: "2",
  item_unit_price: "$12.50",
  shipping_cents: "5.00",
  total_cents: "",
  payment_method: "card",
  payment_status: "PAID",
};
const goodOrder = legacyOrdersImport.parseRow(1, { ...baseOrder });
check("a good legacy order row stages valid; '$12.50' becomes 1250 cents",
  goodOrder.verdict === "valid" &&
    (goodOrder.data as { unitPriceCents: number }).unitPriceCents === 1250 &&
    (goodOrder.data as { shippingCents: number }).shippingCents === 500 &&
    (goodOrder.data as { paymentStatus: string }).paymentStatus === "paid");
check("an undated order row is invalid",
  legacyOrdersImport.parseRow(2, { ...baseOrder, order_date: "last tuesday" }).verdict === "invalid");
check("a non-integer qty is invalid",
  legacyOrdersImport.parseRow(3, { ...baseOrder, item_qty: "two" }).verdict === "invalid");
check("an unknown payment method is invalid",
  legacyOrdersImport.parseRow(4, { ...baseOrder, payment_method: "venmo" }).verdict === "invalid");
check("an unknown payment status is invalid",
  legacyOrdersImport.parseRow(5, { ...baseOrder, payment_status: "pending" }).verdict === "invalid");
check("check method maps to the CHECK enum",
  (legacyOrdersImport.parseRow(6, { ...baseOrder, payment_method: "check" }).data as { paymentMethod: string }).paymentMethod === "CHECK");
check("a missing legacy_order_no is invalid",
  legacyOrdersImport.parseRow(7, { ...baseOrder, legacy_order_no: " " }).verdict === "invalid");

if (failures > 0) {
  console.error(`${failures} P12 unit check(s) failed`);
  process.exit(1);
}
console.log("P12 unit checks passed");
