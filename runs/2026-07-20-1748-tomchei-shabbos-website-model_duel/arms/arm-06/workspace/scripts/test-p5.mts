// Unit checks for P5 helpers: Stripe webhook signature verify/fixture sign,
// fulfillment choice validation (hard zip block, delivery-day list), fee
// resolution + bulk destination dedupe keys, greeting normalization, the
// checkout submit schema, the checkout rate limiter, and the same-origin
// guard. DB-dependent checkout behavior lives in test-checkout.mts + the P5
// smoke script.

// env.ts validates at import time; stripe.ts pulls it in, so give this
// process a minimal valid env before the dynamic imports below.
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

// --- Stripe webhook signature ------------------------------------------------
const { verifyWebhookSignature, signWebhookFixture } = await import("../lib/payments/stripe");
const webhookSecret = "whsec_test_fixture_secret";
const rawBody = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: {} });
const now = 1_800_000_000;
const header = signWebhookFixture(rawBody, webhookSecret, now);
check("fixture signature verifies", verifyWebhookSignature(rawBody, header, webhookSecret, now));
check("wrong secret rejected", !verifyWebhookSignature(rawBody, header, "whsec_other", now));
check("tampered body rejected", !verifyWebhookSignature(rawBody.replace("evt_1", "evt_2"), header, webhookSecret, now));
check(
  "tampered signature rejected",
  !verifyWebhookSignature(rawBody, `${header.slice(0, -2)}ff`, webhookSecret, now),
);
check(
  "replay outside tolerance rejected",
  !verifyWebhookSignature(rawBody, signWebhookFixture(rawBody, webhookSecret, now - 600), webhookSecret, now),
);
check(
  "fresh replay inside tolerance verifies",
  verifyWebhookSignature(rawBody, signWebhookFixture(rawBody, webhookSecret, now - 120), webhookSecret, now),
);
check("missing header rejected", !verifyWebhookSignature(rawBody, null, webhookSecret, now));
check("garbage header rejected", !verifyWebhookSignature(rawBody, "not-a-signature", webhookSecret, now));
check("header without v1 rejected", !verifyWebhookSignature(rawBody, `t=${now}`, webhookSecret, now));

// --- fulfillment choice validation --------------------------------------------
const {
  bulkAddressKey,
  checkoutSubmitSchema,
  effectiveGreeting,
  normalizeGreeting,
  resolveDeliveryFeeCents,
  validateFulfillmentChoice,
} = await import("../lib/checkout/fulfillment");
const zips = ["08701", "08724"];
const days = ["Purim Eve", "Purim Day"];
check("pickup is always allowed", validateFulfillmentChoice({ choice: "PICKUP", postalCode: "99999", deliveryDay: null, deliveryZips: zips, deliveryDays: days }).ok);
check(
  "bulk delivery ignores the zip allowlist",
  validateFulfillmentChoice({ choice: "BULK_DELIVERY", postalCode: "99999", deliveryDay: null, deliveryZips: zips, deliveryDays: days }).ok,
);
check(
  "per-package allowed inside the allowlist with a listed day",
  validateFulfillmentChoice({ choice: "PER_PACKAGE_DELIVERY", postalCode: "08701", deliveryDay: "Purim Day", deliveryZips: zips, deliveryDays: days }).ok,
);
check(
  "per-package hard-blocked outside the allowlist",
  !validateFulfillmentChoice({ choice: "PER_PACKAGE_DELIVERY", postalCode: "07001", deliveryDay: "Purim Day", deliveryZips: zips, deliveryDays: days }).ok,
);
check(
  "per-package rejected without a day",
  !validateFulfillmentChoice({ choice: "PER_PACKAGE_DELIVERY", postalCode: "08701", deliveryDay: null, deliveryZips: zips, deliveryDays: days }).ok,
);
check(
  "per-package rejected with an unlisted day",
  !validateFulfillmentChoice({ choice: "PER_PACKAGE_DELIVERY", postalCode: "08701", deliveryDay: "Tuesday", deliveryZips: zips, deliveryDays: days }).ok,
);
check(
  "per-package rejected while no days are configured",
  !validateFulfillmentChoice({ choice: "PER_PACKAGE_DELIVERY", postalCode: "08701", deliveryDay: "Purim Day", deliveryZips: zips, deliveryDays: [] }).ok,
);

// --- fee resolution + bulk dedupe keys -----------------------------------------
const fees = { bulkPerDestinationCents: 900, perPackagePerRecipientCents: 450 };
check("pickup fee is zero", resolveDeliveryFeeCents("PICKUP", fees) === 0);
check("bulk fee is the per-destination rate", resolveDeliveryFeeCents("BULK_DELIVERY", fees) === 900);
check("per-package fee is the per-recipient rate", resolveDeliveryFeeCents("PER_PACKAGE_DELIVERY", fees) === 450);
const addressA = { line1: "123  Main Street", city: "Lakewood", region: "NJ", postalCode: "08701", country: "US" };
const addressASame = { line1: "123 main street", city: "lakewood", region: "nj", postalCode: "08701", country: "us" };
const addressB = { ...addressA, postalCode: "08724" };
check("bulk key dedupes normalized addresses", bulkAddressKey(addressA) === bulkAddressKey(addressASame));
check("bulk key splits different destinations", bulkAddressKey(addressA) !== bulkAddressKey(addressB));

// --- greetings -------------------------------------------------------------------
check("blank greeting normalizes to null", normalizeGreeting("   ") === null);
check("greeting whitespace collapses", normalizeGreeting("  Happy   Purim! ") === "Happy Purim!");
check("recipient override wins", effectiveGreeting("For Bubby", "Happy Purim") === "For Bubby");
check("order default is the fallback", effectiveGreeting("  ", "Happy Purim") === "Happy Purim");
check("both blank means no card", effectiveGreeting(null, " ") === null);

// --- checkout submit schema -------------------------------------------------------
const submitOk = checkoutSubmitSchema.safeParse({
  draftRef: "MM-2026-0001",
  expectedTotalCents: 5100,
  recipients: [{ recipientId: "r1", fulfillmentChoice: "PICKUP" }],
});
check("minimal submit parses and defaults to card", submitOk.success && submitOk.data.method === "card");
check(
  "offline method parses (the server refuses it explicitly)",
  checkoutSubmitSchema.safeParse({ draftRef: "d", expectedTotalCents: 0, recipients: [], method: "cash" }).success,
);
check(
  "unknown fulfillment choice rejected",
  !checkoutSubmitSchema.safeParse({
    draftRef: "d",
    expectedTotalCents: 0,
    recipients: [{ recipientId: "r1", fulfillmentChoice: "DRONE" }],
  }).success,
);
check(
  "negative expected total rejected",
  !checkoutSubmitSchema.safeParse({ draftRef: "d", expectedTotalCents: -1, recipients: [] }).success,
);
check(
  "over-long greeting rejected",
  !checkoutSubmitSchema.safeParse({
    draftRef: "d",
    expectedTotalCents: 0,
    recipients: [{ recipientId: "r1", fulfillmentChoice: "PICKUP", greeting: "x".repeat(501) }],
  }).success,
);

// --- checkout rate limiter ----------------------------------------------------------
const { checkoutRateLimit } = await import("../lib/rate-limit");
let checkoutAllowed = 0;
for (let i = 0; i < 21; i += 1) if (checkoutRateLimit("10.9.0.1", 3_000_000)) checkoutAllowed += 1;
check("checkout limiter caps at 20/min", checkoutAllowed === 20);
check("checkout limiter resets next window", checkoutRateLimit("10.9.0.1", 3_000_000 + 61_000));
check("checkout limiter isolates IPs", checkoutRateLimit("10.9.0.2", 3_000_000));

// --- same-origin guard ---------------------------------------------------------------
const { assertSameOrigin, guardPublicCheckoutMutation } = await import("../lib/public-guard");
const request = (headers: Record<string, string>) => new Request("http://localhost:3106/api/checkout/submit", { method: "POST", headers });
check("no origin header passes (curl/non-browser)", assertSameOrigin(request({ host: "localhost:3106" })) === null);
check(
  "matching origin passes",
  assertSameOrigin(request({ host: "localhost:3106", origin: "http://localhost:3106" })) === null,
);
const crossSite = assertSameOrigin(request({ host: "localhost:3106", origin: "https://evil.example" }));
check("cross-site origin refused with 403", crossSite !== null && crossSite.status === 403);
const badOrigin = assertSameOrigin(request({ host: "localhost:3106", origin: ":::not a url" }));
check("unparseable origin refused with 403", badOrigin !== null && badOrigin.status === 403);

// --- checkout guard preamble (same-origin + rate limit, one helper) --------------------
check(
  "checkout guard preamble passes a clean same-origin request",
  guardPublicCheckoutMutation(request({ host: "localhost:3106", origin: "http://localhost:3106", "x-forwarded-for": "10.9.1.1" })) === null,
);
const guardCross = guardPublicCheckoutMutation(request({ host: "localhost:3106", origin: "https://evil.example", "x-forwarded-for": "10.9.1.1" }));
check("checkout guard preamble refuses cross-site before touching the limiter", guardCross !== null && guardCross.status === 403);
let guardLimited: number | null = null;
for (let i = 0; i < 25; i += 1) {
  const verdict = guardPublicCheckoutMutation(request({ host: "localhost:3106", "x-forwarded-for": "10.9.1.2" }));
  if (verdict) {
    guardLimited = verdict.status;
    break;
  }
}
check("checkout guard preamble trips the 20/min limiter with 429", guardLimited === 429);

// --- webhook payload schemas (signed but malformed = 400, never an unsafe cast) --------
const { chargeRefundedObjectSchema, checkoutSessionObjectSchema } = await import("../lib/checkout/webhook");
check(
  "session schema accepts a full checkout session",
  checkoutSessionObjectSchema.safeParse({
    id: "cs_1",
    amount_total: 7500,
    payment_intent: "pi_1",
    client_reference_id: "MM-1",
    metadata: { orderId: "o1" },
  }).success,
);
check("session schema tolerates omitted optional fields", checkoutSessionObjectSchema.safeParse({ id: "cs_2" }).success);
check("session schema rejects a missing id", !checkoutSessionObjectSchema.safeParse({ amount_total: 100 }).success);
check("session schema rejects a wrong-typed amount", !checkoutSessionObjectSchema.safeParse({ id: "cs_3", amount_total: "7500" }).success);
check("charge schema accepts a refunded charge", chargeRefundedObjectSchema.safeParse({ id: "ch_1", payment_intent: "pi_1" }).success);
check("charge schema rejects a wrong-typed payment_intent", !chargeRefundedObjectSchema.safeParse({ id: "ch_1", payment_intent: 42 }).success);

// --- safeEqual (no length short-circuit) -----------------------------------------------
const { safeEqual } = await import("../lib/hmac");
check("safeEqual matches identical values", safeEqual("abc123", "abc123"));
check("safeEqual refuses different values", !safeEqual("abc123", "abc124"));
check("safeEqual refuses a length mismatch", !safeEqual("abc", "abcd") && !safeEqual("abcd", "abc"));
check("safeEqual handles empty strings", safeEqual("", "") && !safeEqual("", "a"));

if (failures > 0) {
  console.error(`${failures} P5 check(s) failed`);
  process.exit(1);
}
console.log("All P5 checks passed");
