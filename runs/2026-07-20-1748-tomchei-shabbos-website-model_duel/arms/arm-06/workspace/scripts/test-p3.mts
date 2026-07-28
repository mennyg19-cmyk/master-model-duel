// Unit checks for P3 helpers: HMAC + newsletter tokens, money conversions,
// slugify, delivery-ZIP gate, catalog stock math, product input scalars,
// media upload validation, rate limiting.
import { base64UrlDecode, base64UrlEncode, encodeText, hmacSha256, safeEqual } from "../lib/hmac";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../lib/newsletter/tokens";
import { dollarsToCents, formatCents, formatDelta } from "../lib/money";
import { slugify } from "../lib/text";
import { isDeliverable, normalizePostalCode } from "../lib/storefront/delivery";
import { availableStock, isSoldOut } from "../lib/storefront/catalog";
import { productInputSchema, productScalars } from "../lib/catalog/product-input";
import { validateUpload, sniffImageType, MAX_UPLOAD_BYTES } from "../lib/media/validation";
import { newsletterRateLimit, deliveryCheckRateLimit } from "../lib/rate-limit";

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

// --- hmac ------------------------------------------------------------------
const signature = await hmacSha256("secret", "payload");
check("hmac is deterministic", signature === (await hmacSha256("secret", "payload")));
check("hmac changes with the data", signature !== (await hmacSha256("secret", "payload2")));
check("safeEqual matches equal strings", safeEqual("abc", "abc"));
check("safeEqual rejects different strings", !safeEqual("abc", "abd"));
check("base64url round-trips", new TextDecoder().decode(base64UrlDecode(base64UrlEncode(encodeText("hello")))) === "hello");

// --- newsletter tokens -------------------------------------------------------
const now = Date.now();
const token = await createUnsubscribeToken("sub-123", "secret", 60_000, now);
const verified = await verifyUnsubscribeToken(token, "secret", now + 1_000);
check("token round-trips", verified?.subscriberId === "sub-123");

const [body, sig] = token.split(".");
const tampered = `${body.slice(0, -1)}x.${sig}`;
check("tampered token body rejected", (await verifyUnsubscribeToken(tampered, "secret", now)) === null);
check("wrong secret rejected", (await verifyUnsubscribeToken(token, "other", now)) === null);
check("expired token rejected", (await verifyUnsubscribeToken(token, "secret", now + 120_000)) === null);
check("malformed token rejected", (await verifyUnsubscribeToken("not-a-token", "secret", now)) === null);

// --- money -------------------------------------------------------------------
check("formatCents formats", formatCents(3600) === "$36.00" && formatCents(5) === "$0.05");
check("dollarsToCents converts", dollarsToCents(36) === 3600 && dollarsToCents(1.5) === 150);
check("dollarsToCents rejects fractions of a cent", dollarsToCents(1.005) === null);
check("dollarsToCents rejects negatives and NaN", dollarsToCents(-1) === null && dollarsToCents(NaN) === null);
check("formatDelta renders adjustments", formatDelta(500) === "+$5.00" && formatDelta(0) === "included");

// --- slugify -----------------------------------------------------------------
check("slugify basic", slugify("Shabbos Gift Basket") === "shabbos-gift-basket");
check("slugify strips punctuation", slugify("Challah & Wine!") === "challah-wine");
check("slugify collapses dashes", slugify("  Purim   Basket 2026 ") === "purim-basket-2026");
check("slugify of symbol soup is empty", slugify("!!!") === "");

// --- delivery ZIP gate ---------------------------------------------------------
const seedZips = ["11218", "11230", "11219", "11204", "11210", "11234"];
check("in-list ZIP is deliverable", isDeliverable(seedZips, "11218"));
check("out-of-list ZIP is not deliverable", !isDeliverable(seedZips, "10001"));
check("ZIP normalizes whitespace", normalizePostalCode(" 11218 ") === "11218" && isDeliverable(seedZips, "112 18"));
check("empty allowlist blocks everything", !isDeliverable([], "11218"));

// --- catalog stock math ----------------------------------------------------------
check("untracked products have no ceiling", availableStock({ trackInventory: false, inventoryItem: null }) === null);
check(
  "tracked stock subtracts reserved",
  availableStock({ trackInventory: true, inventoryItem: { onHand: 10, reserved: 3 } }) === 7,
);
check(
  "tracked without inventory row has none",
  availableStock({ trackInventory: true, inventoryItem: null }) === 0,
);
check(
  "sold out at zero without backorder",
  isSoldOut({ trackInventory: true, allowBackorder: false, inventoryItem: { onHand: 2, reserved: 2 } }),
);
check(
  "backorder keeps the buy path open",
  !isSoldOut({ trackInventory: true, allowBackorder: true, inventoryItem: { onHand: 0, reserved: 0 } }),
);
check("untracked is never sold out", !isSoldOut({ trackInventory: false, allowBackorder: false, inventoryItem: null }));

// --- product input ----------------------------------------------------------------
const validProduct = productInputSchema.safeParse({
  seasonId: "s1",
  name: "Gift Basket",
  kind: "GOOD",
  basePriceDollars: 36,
  trackInventory: false,
  allowBackorder: false,
  active: true,
});
check("product input accepts a valid payload", validProduct.success);

const scalars = validProduct.success ? productScalars(validProduct.data) : null;
check("product scalars convert price to cents", scalars?.ok === true && scalars.data.basePriceCents === 3600);
check(
  "product scalars reject a bad price",
  productScalars({ ...validProduct.data!, basePriceDollars: 1.005 }).ok === false,
);
check(
  "product input rejects empty name",
  !productInputSchema.safeParse({ ...validProduct.data!, name: "" }).success,
);

// --- media upload validation ----------------------------------------------------------
check(
  "jpeg upload validates",
  validateUpload({ filename: "photo.jpg", contentType: "image/jpeg", sizeBytes: 1000 }).ok,
);
check(
  "jpeg extension alias validates",
  validateUpload({ filename: "photo.jpeg", contentType: "image/jpeg", sizeBytes: 1000 }).ok,
);
check(
  "exe is rejected",
  !validateUpload({ filename: "virus.exe", contentType: "application/x-msdownload", sizeBytes: 1000 }).ok,
);
check(
  "extension/type mismatch is rejected",
  !validateUpload({ filename: "photo.png", contentType: "image/jpeg", sizeBytes: 1000 }).ok,
);
check(
  "oversized upload is rejected",
  !validateUpload({ filename: "photo.png", contentType: "image/png", sizeBytes: MAX_UPLOAD_BYTES + 1 }).ok,
);
check(
  "empty upload is rejected",
  !validateUpload({ filename: "photo.png", contentType: "image/png", sizeBytes: 0 }).ok,
);

// --- magic-byte sniffing -------------------------------------------------------
const pngMagic = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpegMagic = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const gifMagic = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const webpMagic = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
check("png magic detected", sniffImageType(pngMagic) === "image/png");
check("jpeg magic detected", sniffImageType(jpegMagic) === "image/jpeg");
check("gif magic detected", sniffImageType(gifMagic) === "image/gif");
check("webp magic detected", sniffImageType(webpMagic) === "image/webp");
check("text bytes match nothing", sniffImageType(encodeText("not an image!!")) === null);
check("short buffer matches nothing", sniffImageType(Uint8Array.from([0x89, 0x50])) === null);

// --- rate limiting ---------------------------------------------------------------
const windowStart = 1_000_000;
check("first subscribe hits pass", newsletterRateLimit("1.1.1.1", windowStart));
let subscribeBlocked = false;
for (let hit = 0; hit < 10; hit += 1) {
  subscribeBlocked = !newsletterRateLimit("1.1.1.1", windowStart + hit);
}
check("subscribe blocks past 10 in a window", subscribeBlocked);
check("subscribe window resets", newsletterRateLimit("1.1.1.1", windowStart + 61_000));
check("subscribe keys are independent", newsletterRateLimit("2.2.2.2", windowStart + 5));
check("delivery-check allows bursts under 60", deliveryCheckRateLimit("3.3.3.3", windowStart));
check(
  "subscribe and delivery-check buckets are separate",
  deliveryCheckRateLimit("1.1.1.1", windowStart + 10),
);

if (failures > 0) {
  console.error(`\n${failures} P3 check(s) failed`);
  process.exit(1);
}
console.log("\nAll P3 checks passed");
