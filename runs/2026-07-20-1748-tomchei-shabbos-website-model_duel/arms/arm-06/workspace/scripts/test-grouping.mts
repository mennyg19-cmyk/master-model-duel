// Unit checks for the package grouping engine (UR-001): same
// recipient/address/method/greeting merges; any difference splits.
import { buildGroupingKey, groupPackageInputs, type PackageGroupInput } from "../lib/packages/grouping";

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

const base: PackageGroupInput = {
  recipientName: "Esther Cohen",
  recipientAddressId: "addr-1",
  fulfillmentMethodCode: "DELIVERY",
  greeting: "Happy Purim!",
};

check("identical inputs share a key", buildGroupingKey(base) === buildGroupingKey({ ...base }));

check(
  "same recipient/address/method/greeting merges into one group",
  groupPackageInputs([base, { ...base }]).size === 1,
);

check(
  "differing greeting splits",
  groupPackageInputs([base, { ...base, greeting: "Chag Sameach" }]).size === 2,
);

check(
  "differing address splits",
  groupPackageInputs([base, { ...base, recipientAddressId: "addr-2" }]).size === 2,
);

check(
  "differing fulfillment method splits",
  groupPackageInputs([base, { ...base, fulfillmentMethodCode: "PICKUP" }]).size === 2,
);

check(
  "differing recipient splits",
  groupPackageInputs([base, { ...base, recipientName: "Mordechai Cohen" }]).size === 2,
);

check(
  "greeting case/whitespace differences still merge",
  groupPackageInputs([base, { ...base, greeting: "  happy   purim! " }]).size === 1,
);

check(
  "null and empty greeting are the same bucket",
  groupPackageInputs([{ ...base, greeting: null }, { ...base, greeting: "" }]).size === 1,
);

check(
  "pickup (null address) groups by method + greeting",
  groupPackageInputs([
    { ...base, recipientAddressId: null, fulfillmentMethodCode: "PICKUP", greeting: null },
    { ...base, recipientAddressId: null, fulfillmentMethodCode: "PICKUP", greeting: "" },
  ]).size === 1,
);

const merged = groupPackageInputs([base, { ...base }, { ...base, greeting: "Different" }]);
check(
  "merge keeps all members in their groups",
  merged.size === 2 && [...merged.values()].some((group) => group.length === 2),
);

if (failures > 0) {
  console.error(`${failures} grouping check(s) failed`);
  process.exit(1);
}
console.log("All grouping checks passed");
