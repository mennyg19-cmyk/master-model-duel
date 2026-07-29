// Unit checks for P8 pure helpers: the UR-003 margin engine (ground-only
// eligibility, cheapest-per-carrier, charge-high/buy-low), R-081 bin packing
// (fill efficiency, tare weight, dimensional fit with rotation), the Shippo
// fixture double (zip-zoned deterministic pricing, scripted failure seams),
// choice→method mapping, and grouping-key address overrides. DB-backed P8
// behavior (checkout quoting, label lifecycle) lives in test-p8-domain.mts.

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

// --- margin engine (UR-003/G-006) ------------------------------------------
const { normalizeRates, eligibleRates, resolveMargin } = await import("../lib/shipping/margin");

const rates = normalizeRates([
  { object_id: "r-fdx-ground", amount: "21.97", currency: "USD", provider: "FedEx", servicelevel: { token: "fedex_ground", name: "FedEx Ground®" }, estimated_days: 5 },
  { object_id: "r-fdx-air", amount: "39.55", currency: "USD", provider: "FedEx", servicelevel: { token: "fedex_express_saver", name: "FedEx Express Saver®" }, estimated_days: 3 },
  { object_id: "r-ups-ground", amount: "15.00", currency: "USD", provider: "UPS", servicelevel: { token: "ups_ground", name: "UPS® Ground" }, estimated_days: 5 },
  { object_id: "r-ups-air", amount: "33.00", currency: "USD", provider: "UPS", servicelevel: { token: "ups_next_day_air", name: "UPS Next Day Air®" }, estimated_days: 1 },
  { object_id: "r-usps", amount: "10.35", currency: "USD", provider: "USPS", servicelevel: { token: "usps_priority", name: "USPS Priority Mail" }, estimated_days: 3 },
  { object_id: "r-garbage", amount: "not-a-number", currency: "USD", provider: "FedEx", servicelevel: { token: "fedex_ground", name: "" }, estimated_days: null },
]);

check("normalizeRates parses cents and drops unreadable amounts", rates.length === 5 && rates[0].amountCents === 2197);

const eligible = eligibleRates(rates, false);
check(
  "eligibility keeps only ground-comparable services, cheapest per carrier, USPS off by default",
  eligible.length === 2 && eligible[0].rateId === "r-ups-ground" && eligible[1].rateId === "r-fdx-ground",
);
check(
  "USPS enters the contest only when the deployment includes it",
  eligibleRates(rates, true).length === 3 && eligibleRates(rates, true)[0].rateId === "r-usps",
);

const margin = resolveMargin(rates, false)!;
check(
  "charge = highest eligible quote, buy = cheapest, margin is the spread",
  margin.charge.rateId === "r-fdx-ground" && margin.buy.rateId === "r-ups-ground" && margin.marginCents === 697,
);
const loneCarrier = resolveMargin([rates[0], rates[1]], false)!;
check(
  "one carrier quoting alone charges and buys the same rate (margin 0, honestly recorded)",
  loneCarrier.charge.rateId === "r-fdx-ground" && loneCarrier.buy.rateId === "r-fdx-ground" && loneCarrier.marginCents === 0,
);
check("no ground-comparable rates means no quote at all", resolveMargin([rates[1], rates[3]], false) === null);

// --- bin packing (R-081) ------------------------------------------------------
const { planParcels } = await import("../lib/shipping/packing");

const box = { name: "Box", lengthMm: 400, widthMm: 300, heightMm: 200, tareWeightGrams: 100 };
const unit = { lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 1500, qty: 1 };

const oneParcel = planParcels([unit], [box]);
check(
  "one unit packs into one parcel with gross weight = tare + contents",
  oneParcel.length === 1 && oneParcel[0].weightGrams === 1600 && oneParcel[0].itemCount === 1,
);
// Volume: item 6L, box 24L at 85% fill → 3 per parcel; 7 units split 3/3/1.
const seven = planParcels([{ ...unit, qty: 7 }], [box]);
check(
  "fill efficiency overflows into multiple parcels (7 units → 3 parcels, 3/3/1)",
  seven.length === 3 && seven[0].itemCount === 3 && seven[2].itemCount === 1,
);
const rotated = planParcels([{ lengthMm: 100, widthMm: 400, heightMm: 200, weightGrams: 500, qty: 1 }], [{ name: "Flat", lengthMm: 250, widthMm: 450, heightMm: 150, tareWeightGrams: 50 }]);
check("dimensional fit is rotation-aware (sorted dims)", rotated.length === 1);
const { DomainRuleError } = await import("../lib/errors");
let oversizedThrew = false;
try {
  planParcels([{ lengthMm: 900, widthMm: 900, heightMm: 900, weightGrams: 100, qty: 1 }], [box]);
} catch (error) {
  oversizedThrew = (error as Error).name === DomainRuleError.name;
}
check("an item that fits no box refuses instead of under-declaring", oversizedThrew);

// --- fixture double -----------------------------------------------------------
const fixture = await import("../lib/shipping/fixture-double");
const parcel = { length: "400", width: "300", height: "200", distance_unit: "mm", weight: "1600", mass_unit: "g" };

check(
  "default zone prices FedEx above UPS for the same parcel",
  fixture.fixtureRateCents("fedex", "fedex_ground", [parcel], "10952") === 2197
    && fixture.fixtureRateCents("ups", "ups_ground", [parcel], "10952") === 1500,
);
check(
  "the west zone flips which carrier is expensive — selection follows the math",
  fixture.fixtureRateCents("ups", "ups_ground", [parcel], "90210") === 2375
    && fixture.fixtureRateCents("fedex", "fedex_ground", [parcel], "90210") === 1690,
);

const shipment = fixture.fixtureCreateShipment({ address_to: { street1: "9 Hilltop Rd", zip: "10952" }, parcels: [parcel] });
check(
  "shipment create returns ground + express rates for every fixture carrier",
  shipment.status === 201 && (shipment.payload as { rates: unknown[] }).rates.length === 5,
);
check(
  "FAILRATES seam 500s the rate fetch",
  fixture.fixtureCreateShipment({ address_to: { street1: "1 FAILRATES Ave" }, parcels: [parcel] }).status === 500,
);

const buyOk = fixture.fixtureCreateTransaction({ rate: "rate_ups_ups_ground_1500" });
const buyPayload = buyOk.payload as { status: string; tracking_number?: string; rate: { amount: string } };
check(
  "buying a quoted rate succeeds with a tracking number and the same price",
  buyOk.status === 201 && buyPayload.status === "SUCCESS" && buyPayload.tracking_number?.startsWith("1ZUPS") === true && buyPayload.rate.amount === "15.00",
);
// A FAILBUY shipment re-registers the same deterministic rate ids, so the
// next buy of that rate hits the seam — mirroring "create shipment, then buy
// its rate" in the wrapper.
fixture.fixtureCreateShipment({ address_to: { street1: "7 FAILBUY Ct", zip: "10952" }, parcels: [parcel] });
const buyFailSeamed = fixture.fixtureCreateTransaction({ rate: "rate_fedex_fedex_ground_2197" });
check(
  "FAILBUY seam returns a carrier ERROR transaction (the R-175 leg)",
  buyFailSeamed.status === 201 && (buyFailSeamed.payload as { status: string }).status === "ERROR",
);
check("unknown rates are refused", fixture.fixtureCreateTransaction({ rate: "rate_ups_ups_ground_999999" }).status === 400);

check(
  "BADADDR seam fails validation with carrier messages",
  (() => {
    const result = fixture.fixtureValidateAddress({ street1: "13 BADADDR Way" });
    const payload = result.payload as { validation_results: { is_valid: boolean; messages: unknown[] } };
    return payload.validation_results.is_valid === false && payload.validation_results.messages.length > 0;
  })(),
);
check(
  "normal addresses validate clean",
  (fixture.fixtureValidateAddress({ street1: "9 Hilltop Rd" }).payload as { validation_results: { is_valid: boolean } }).validation_results.is_valid === true,
);
check(
  "voiding an unknown transaction is an ERROR, voiding a real one succeeds",
  (fixture.fixtureCreateRefund({ transaction: "txn_missing" }).payload as { status: string }).status === "ERROR"
    && (fixture.fixtureCreateRefund({ transaction: (buyOk.payload as { object_id: string }).object_id }).payload as { status: string }).status === "SUCCESS",
);
check(
  "tracking a fixture label reports TRANSIT",
  (fixture.fixtureGetTrack("ups", buyPayload.tracking_number!).payload as { tracking_status: { status: string } }).tracking_status.status === "TRANSIT",
);

// --- choice → method + grouping keys ------------------------------------------
const { methodCodeForChoice } = await import("../lib/packages/materialize");
check("SHIPPED maps to the SHIPPED method's stage list", methodCodeForChoice("SHIPPED") === "SHIPPED");

const { buildGroupingKey } = await import("../lib/packages/grouping");
const base = { recipientName: "Guest Twins", fulfillmentMethodCode: "SHIPPED", greeting: null };
check(
  "an inline address key groups guest SHIPPED packages by address, not by the null book id",
  buildGroupingKey({ ...base, recipientAddressId: null, addressKey: "addr-a" })
    !== buildGroupingKey({ ...base, recipientAddressId: null, addressKey: "addr-b" }),
);
check(
  "same inline address merges even across book rows",
  buildGroupingKey({ ...base, recipientAddressId: "book-1", addressKey: "addr-a" })
    === buildGroupingKey({ ...base, recipientAddressId: null, addressKey: "addr-a" }),
);

if (failures > 0) {
  console.error(`${failures} P8 unit check(s) failed`);
  process.exit(1);
}
console.log("All P8 unit checks passed");
