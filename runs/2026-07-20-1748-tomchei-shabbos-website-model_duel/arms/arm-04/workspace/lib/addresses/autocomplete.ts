import { db } from "@/lib/db";

export type AddressSuggestion = {
  source: "address-book" | "local-area";
  recipient?: string;
  addressId?: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
};

// Street index for the delivery area. There is no address-API key in this
// environment, so autocomplete works off this local list plus the customer's
// own saved addresses; a real provider would replace localAreaMatches only.
const LOCAL_STREETS: { street: string; city: string; state: string; zip: string }[] = [
  { street: "Main St", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "Clifton Ave", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "Madison Ave", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "Forest Ave", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "Ridge Ave", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "County Line Rd", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "Squankum Rd", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "New Hampshire Ave", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "Cedar Bridge Ave", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "Pine St", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "River Ave", city: "Lakewood", state: "NJ", zip: "08701" },
  { street: "E Veterans Hwy", city: "Jackson", state: "NJ", zip: "08527" },
  { street: "Hooper Ave", city: "Toms River", state: "NJ", zip: "08753" },
];

function localAreaMatches(query: string): AddressSuggestion[] {
  // "123 Main" → suggest "123 Main St, Lakewood": keep any leading house
  // number, match the rest against the street index.
  const houseNumber = query.match(/^\s*(\d+)\s+(.*)$/);
  const streetQuery = (houseNumber ? houseNumber[2] : query).toLowerCase();
  if (streetQuery.length < 2) return [];
  return LOCAL_STREETS.filter((entry) => entry.street.toLowerCase().includes(streetQuery)).map(
    (entry) => ({
      source: "local-area" as const,
      line1: houseNumber ? `${houseNumber[1]} ${entry.street}` : entry.street,
      city: entry.city,
      state: entry.state,
      zip: entry.zip,
    })
  );
}

export async function suggestAddresses(
  query: string,
  customerId: string | null
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const savedMatches: AddressSuggestion[] = customerId
    ? (
        await db.customerAddress.findMany({
          where: {
            customerId,
            OR: [
              { recipient: { contains: trimmed, mode: "insensitive" } },
              { line1: { contains: trimmed, mode: "insensitive" } },
            ],
          },
          take: 5,
          orderBy: { updatedAt: "desc" },
        })
      ).map((address) => ({
        source: "address-book" as const,
        addressId: address.id,
        recipient: address.recipient,
        line1: address.line1,
        city: address.city,
        state: address.state,
        zip: address.zip,
      }))
    : [];

  return [...savedMatches, ...localAreaMatches(trimmed)].slice(0, 8);
}
