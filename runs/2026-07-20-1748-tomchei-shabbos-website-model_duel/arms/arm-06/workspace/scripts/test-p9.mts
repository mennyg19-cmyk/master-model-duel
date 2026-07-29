// Unit checks for P9 pure helpers: the geo law (haversine, street keys,
// normalized cache keys, one-line + Google Maps URLs), the nearest-neighbor
// optimizer and its Mapbox seam fallback, magic-link token/PIN hashing and
// the HMAC PIN cookie, and the notification channel policy. DB-backed P9
// behavior (route build/lifecycle, switch/reroute, pickup, bulk, reminders)
// lives in test-p9-domain.mts.

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

// --- geo law ------------------------------------------------------------------
const { haversineMiles, streetKey, normalizedAddressKey, oneLineAddress, googleMapsDirectionsUrl } = await import(
  "../lib/routes/geo"
);

const lakewood = { lat: 40.082, lng: -74.21 };
const monsey = { lat: 41.111, lng: -74.069 };
const miles = haversineMiles(lakewood, monsey);
check("haversine Lakewood->Monsey is about 71 miles", miles > 68 && miles < 75);
check("haversine is symmetric and zero for identical points", haversineMiles(monsey, lakewood) === miles && haversineMiles(lakewood, lakewood) === 0);

check(
  "streetKey strips the house number and normalizes suffixes/case",
  streetKey("123 Main Street") === streetKey("480 main st") && streetKey("12 Oak Avenue") === streetKey("99 oak ave"),
);
check("streetKey keeps distinct streets distinct", streetKey("1 First St") !== streetKey("1 Second St"));

const addrA = { line1: "9 Hilltop Rd", line2: null, city: "Lakewood", region: "NJ", postalCode: "10952", country: "US" };
const addrB = { line1: "  9 HILLTOP RD ", line2: null, city: "LAKEWOOD", region: "nj", postalCode: "10952", country: "us" };
check("normalizedAddressKey is case/space-insensitive (one cache row per address)", normalizedAddressKey(addrA) === normalizedAddressKey(addrB));
check(
  "normalizedAddressKey separates on any field (line2 matters)",
  normalizedAddressKey({ ...addrA, line2: "Apt 4" }) !== normalizedAddressKey(addrA),
);

check(
  "oneLineAddress composes and skips a missing line2",
  oneLineAddress(addrA) === "9 Hilltop Rd, Lakewood, NJ 10952" && oneLineAddress({ ...addrA, line2: "Apt 4" }) === "9 Hilltop Rd, Apt 4, Lakewood, NJ 10952",
);
const mapsUrl = googleMapsDirectionsUrl({ ...addrA, line2: "Apt 4" });
check(
  "the Google Maps deep link is a universal dir URL with the encoded destination",
  mapsUrl.startsWith("https://www.google.com/maps/dir/?api=1&destination=") && mapsUrl.includes(encodeURIComponent("9 Hilltop Rd, Apt 4, Lakewood, NJ 10952")),
);

// --- optimizer ------------------------------------------------------------------
const { orderStopsNearestNeighbor, orderStops } = await import("../lib/routes/optimize");

const origin = { lat: 40.0, lng: -74.0 };
const near = { lat: 40.01, lng: -74.0 };
const far = { lat: 41.0, lng: -75.0 };
const mid = { lat: 40.5, lng: -74.5 };
const greedy = orderStopsNearestNeighbor(origin, [far, near, mid]);
check("nearest-neighbor visits near, then mid, then far", greedy.length === 3 && greedy[0] === 1 && greedy[1] === 2 && greedy[2] === 0);
check("nearest-neighbor covers every stop exactly once", [...greedy].sort().join(",") === "0,1,2");
check("an empty stop set optimizes to an empty order", orderStopsNearestNeighbor(origin, []).length === 0);

// No MAPBOX_ACCESS_TOKEN in this environment: the seam must fall through to
// the deterministic optimizer and say so honestly.
const noKey = await orderStops(origin, [far, near, mid]);
check("without a Mapbox key the provider reports nearest-neighbor", noKey.provider === "nearest-neighbor" && noKey.order[0] === 1);
const single = await orderStops(origin, [near]);
check("a single stop needs no optimizer at all", single.provider === "nearest-neighbor" && single.order.length === 1 && single.order[0] === 0);

// --- magic-link hashing + PIN cookie ---------------------------------------------
const { hashLinkToken, isPinFormat, issuePinCookie, verifyPinCookie } = await import("../lib/routes/links");

check("token hashes are stable and input-sensitive", hashLinkToken("abc") === hashLinkToken("abc") && hashLinkToken("abc") !== hashLinkToken("abd"));
check("PIN format is exactly 4 digits", isPinFormat("1234") && !isPinFormat("123") && !isPinFormat("12345") && !isPinFormat("12a4"));

const linkExpiry = new Date(Date.now() + 60_000);
const cookie = await issuePinCookie("link-1", linkExpiry);
check("a fresh PIN cookie verifies for its own link", await verifyPinCookie(cookie, "link-1"));
check("the cookie is bound to its link id (worthless for any other route)", !(await verifyPinCookie(cookie, "link-2")));
const expiredCookie = await issuePinCookie("link-1", new Date(Date.now() - 1_000));
check("an expired cookie never verifies", !(await verifyPinCookie(expiredCookie, "link-1")));
check("garbage cookies never verify", !(await verifyPinCookie("not.a.cookie", "link-1")) && !(await verifyPinCookie(undefined, "link-1")));

// --- notification channel policy ---------------------------------------------------
const { NOTIFY_CHANNELS } = await import("../lib/notify/outbox");
check(
  "operational notices go email + SMS; follow-ups are email-only",
  NOTIFY_CHANNELS.day_of_delivery.join(",") === "EMAIL,SMS"
    && NOTIFY_CHANNELS.bulk_scheduled.join(",") === "EMAIL,SMS"
    && NOTIFY_CHANNELS.pickup_ready.join(",") === "EMAIL,SMS"
    && NOTIFY_CHANNELS.pickup_expired.join(",") === "EMAIL"
    && NOTIFY_CHANNELS.payment_reminder.join(",") === "EMAIL",
);

if (failures > 0) {
  console.error(`${failures} P9 unit check(s) failed`);
  process.exit(1);
}
console.log("All P9 unit checks passed");
