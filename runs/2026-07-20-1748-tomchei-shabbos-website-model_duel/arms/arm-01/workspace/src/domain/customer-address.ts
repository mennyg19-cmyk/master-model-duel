export type AddressInput = {
  label?: string;
  recipientName: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode?: string;
};

function normalizeAddressPart(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function normalizeAddressKey(address: AddressInput) {
  return [
    normalizeAddressPart(address.line1),
    normalizeAddressPart(address.line2 ?? ""),
    normalizeAddressPart(address.city),
    normalizeAddressPart(address.region),
    normalizeAddressPart(address.postalCode),
    normalizeAddressPart(address.countryCode ?? "US"),
  ].join("|");
}

export function validateAddress(address: AddressInput) {
  const requiredValues = [
    address.recipientName,
    address.line1,
    address.city,
    address.region,
    address.postalCode,
  ];
  if (requiredValues.some((value) => !value?.trim())) {
    throw new Error("Recipient, street, city, region, and postal code are required.");
  }
  if (
    (address.countryCode ?? "US").toUpperCase() === "US" &&
    !/^\d{5}(?:-\d{4})?$/.test(address.postalCode.trim())
  ) {
    throw new Error("US postal code must contain five digits, optionally followed by four digits.");
  }

  return {
    label: address.label?.trim() || null,
    recipientName: address.recipientName.trim(),
    line1: address.line1.trim(),
    line2: address.line2?.trim() || null,
    city: address.city.trim(),
    region: address.region.trim().toUpperCase(),
    postalCode: address.postalCode.trim(),
    countryCode: (address.countryCode ?? "US").trim().toUpperCase(),
    normalizedKey: normalizeAddressKey(address),
    geocodedAt: new Date(),
    geocodeProvider: "server-postal-validation",
  };
}
