// Unit checks for P4 helpers: signed-JSON session codec, guest draft tokens,
// address normalization/dedupe keys, deterministic geocode seam, the cart
// reducer + totals math, and the new rate limiters. DB-dependent draft
// behavior (save/load/cancel, ownership, anti-enumeration) is covered by the
// P4 smoke script, not here.

// env.ts validates at import time; guest-token/addresses pull it in, so give
// this process a minimal valid env before the dynamic imports below.
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

// --- signed JSON session codec ------------------------------------------------
const { encodeSignedJson, decodeSignedJson } = await import("../lib/session-codec");
const secret = "codec-secret-codec-secret-codec-secret";
const payload = { sub: "cust-1", sid: "sess-1", exp: Date.now() + 60_000 };
const encoded = await encodeSignedJson(payload, secret);
check("signed json round-trips", JSON.stringify(await decodeSignedJson(encoded, secret)) === JSON.stringify(payload));
check("signed json rejects wrong secret", (await decodeSignedJson(encoded, "other-secret-other-secret-other")) === null);
const [codecBody, codecSig] = encoded.split(".");
check(
  "signed json rejects tampered body",
  (await decodeSignedJson(`${codecBody.slice(0, -2)}xx.${codecSig}`, secret)) === null,
);
check(
  "signed json rejects tampered signature",
  (await decodeSignedJson(`${codecBody}.${codecSig.slice(0, -2)}xx`, secret)) === null,
);
check("signed json rejects garbage", (await decodeSignedJson("not-a-session", secret)) === null);

// --- guest draft tokens ---------------------------------------------------------
const { generateGuestToken, hashGuestToken, verifyGuestToken } = await import("../lib/orders/guest-token");
const rawToken = generateGuestToken();
check("guest token is url-safe", /^[A-Za-z0-9_-]+$/.test(rawToken));
check("guest tokens are unique", generateGuestToken() !== rawToken);
const tokenHash = await hashGuestToken(rawToken);
check("guest token hash is deterministic", (await hashGuestToken(rawToken)) === tokenHash);
check("guest token verifies", await verifyGuestToken(rawToken, tokenHash));
check("wrong token rejected", !(await verifyGuestToken(generateGuestToken(), tokenHash)));
check("null stored hash rejects", !(await verifyGuestToken(rawToken, null)));

// --- address normalization + dedupe keys -----------------------------------------
const { addressDedupeKey, normalizeAddressInput, addressInputSchema } = await import("../lib/customers/addresses");
const baseAddress = {
  label: null,
  line1: "123 Main Street",
  line2: null,
  city: "Lakewood",
  region: "NJ",
  postalCode: "08701",
  country: "US",
};
const normalized = normalizeAddressInput({ ...baseAddress, line1: "  123   Main  Street " });
check("normalization collapses whitespace", normalized.line1 === "123 Main Street");
check("normalization uppercases country", normalizeAddressInput({ ...baseAddress, country: "us" }).country === "US");
check("normalization nulls empty line2", normalizeAddressInput({ ...baseAddress, line2: "  " }).line2 === "");
check(
  "dedupe key ignores case and spacing",
  addressDedupeKey({ ...baseAddress, line1: "123  MAIN street" }) === addressDedupeKey(baseAddress),
);
check(
  "dedupe key treats null and empty line2 alike",
  addressDedupeKey(baseAddress) === addressDedupeKey({ ...baseAddress, line2: "" }),
);
check(
  "dedupe key splits on ZIP",
  addressDedupeKey(baseAddress) !== addressDedupeKey({ ...baseAddress, postalCode: "08702" }),
);
check("schema rejects missing street", !addressInputSchema.safeParse({ ...baseAddress, line1: " " }).success);
check("schema rejects long country", !addressInputSchema.safeParse({ ...baseAddress, country: "USA" }).success);

// --- deterministic geocode seam -----------------------------------------------------
const { deriveGeoPoint } = await import("../lib/customers/geocode");
const point = deriveGeoPoint("123 main street||lakewood|nj|08701|us");
check(
  "geocode is deterministic",
  deriveGeoPoint("123 main street||lakewood|nj|08701|us").lat === point.lat &&
    deriveGeoPoint("123 main street||lakewood|nj|08701|us").lng === point.lng,
);
check("geocode stays inside the service area", point.lat >= 39.95 && point.lat <= 40.2 && point.lng >= -74.35 && point.lng <= -74.1);
check(
  "different addresses geocode differently",
  deriveGeoPoint("456 other road||lakewood|nj|08701|us").lat !== point.lat ||
    deriveGeoPoint("456 other road||lakewood|nj|08701|us").lng !== point.lng,
);

// --- cart reducer ---------------------------------------------------------------------
const { draftReducer, EMPTY_DRAFT, lineTotalCents, cartTotalCents } = await import(
  "../components/order-builder/draft-reducer"
);
const lineA = { clientId: "l1", productId: "p1", optionValueId: null, qty: 2, addOnIds: [], recipientClientId: null };
const lineB = { clientId: "l2", productId: "p2", optionValueId: "ov1", qty: 1, addOnIds: ["ao1"], recipientClientId: null };
let state = draftReducer(EMPTY_DRAFT, { type: "add-line", line: lineA });
state = draftReducer(state, { type: "add-line", line: lineB });
check("add-line appends", state.lines.length === 2);
check("set-qty updates", draftReducer(state, { type: "set-qty", clientId: "l1", qty: 5 }).lines[0].qty === 5);
check("set-qty zero removes", draftReducer(state, { type: "set-qty", clientId: "l1", qty: 0 }).lines.length === 1);
check("remove-line removes", draftReducer(state, { type: "remove-line", clientId: "l2" }).lines.length === 1);
const recipient = {
  clientId: "r1",
  source: "new" as const,
  name: "Esther Cohen",
  line1: "123 Main Street",
  line2: null,
  city: "Lakewood",
  region: "NJ",
  postalCode: "08701",
  country: "US",
  addressId: null,
  saveToBook: true,
  label: null,
};
state = draftReducer(state, { type: "upsert-recipient", recipient });
check("upsert-recipient inserts", state.recipients.length === 1);
state = draftReducer(state, { type: "assign-recipient", clientId: "l1", recipientClientId: "r1" });
check("assign-recipient links the line", state.lines[0].recipientClientId === "r1");
const renamed = draftReducer(state, { type: "upsert-recipient", recipient: { ...recipient, name: "E. Cohen" } });
check("upsert-recipient updates in place", renamed.recipients.length === 1 && renamed.recipients[0].name === "E. Cohen");
const removed = draftReducer(state, { type: "remove-recipient", clientId: "r1" });
check(
  "remove-recipient unassigns its lines",
  removed.recipients.length === 0 && removed.lines[0].recipientClientId === null,
);
check("hydrate replaces state", draftReducer(state, { type: "hydrate", state: EMPTY_DRAFT }).lines.length === 0);
check("clear empties", draftReducer(state, { type: "clear" }) === EMPTY_DRAFT);

// --- totals math -----------------------------------------------------------------------
const product = {
  id: "p2",
  basePriceCents: 3600,
  options: [{ id: "o1", values: [{ id: "ov1", priceDeltaCents: 500 }] }],
  addOns: [{ id: "ao1", priceCents: 250 }],
};
check("line total includes option delta and add-ons", lineTotalCents(lineB, product) === 4350);
check("line total multiplies by qty", lineTotalCents({ ...lineB, qty: 3 }, product) === 13050);
check(
  "line total ignores unknown option/add-on ids",
  lineTotalCents({ ...lineB, optionValueId: "nope", addOnIds: ["nope"] }, product) === 3600,
);
check(
  "cart total sums lines and skips unknown products",
  cartTotalCents({ lines: [lineB, { ...lineA, productId: "ghost" }], recipients: [] }, [product]) === 4350,
);

// --- rate limiters -----------------------------------------------------------------------
const { addressValidateRateLimit, draftSaveRateLimit } = await import("../lib/rate-limit");
let validateAllowed = 0;
for (let i = 0; i < 31; i += 1) if (addressValidateRateLimit("10.0.0.1", 1_000_000)) validateAllowed += 1;
check("address-validate limiter caps at 30/min", validateAllowed === 30);
check("address-validate limiter resets next window", addressValidateRateLimit("10.0.0.1", 1_000_000 + 61_000));
check("address-validate limiter isolates IPs", addressValidateRateLimit("10.0.0.2", 1_000_000));
let draftAllowed = 0;
for (let i = 0; i < 61; i += 1) if (draftSaveRateLimit("10.0.0.1", 2_000_000)) draftAllowed += 1;
check("draft-save limiter caps at 60/min", draftAllowed === 60);

if (failures > 0) {
  console.error(`${failures} P4 check(s) failed`);
  process.exit(1);
}
console.log("All P4 checks passed");
