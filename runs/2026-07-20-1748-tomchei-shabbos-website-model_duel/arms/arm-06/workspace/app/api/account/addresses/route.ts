import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { parseBody } from "@/lib/parse-body";
import { requireApiCustomer } from "@/lib/customers/session";
import { addressInputSchema, addressSummary, saveAddress } from "@/lib/customers/addresses";

// R-024/R-043: the signed-in customer's address book. GET doubles as the
// builder's address-autocomplete source (?q= filters on label/line1/city).
function serialize(address: Awaited<ReturnType<typeof prisma.address.findMany>>[number]) {
  return {
    id: address.id,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
    lat: address.lat,
    lng: address.lng,
    geocodedAt: address.geocodedAt,
    summary: addressSummary(address),
  };
}

export async function GET(request: Request) {
  const gate = await requireApiCustomer();
  if (!gate.ok) return gate.response;

  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const addresses = await prisma.address.findMany({
    where: { customerId: gate.ctx.customer.id },
    orderBy: [{ label: "asc" }, { createdAt: "asc" }],
  });
  const filtered = query
    ? addresses.filter((address) =>
        [address.label ?? "", address.line1, address.city, address.postalCode]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : addresses;
  return NextResponse.json({ ok: true, addresses: filtered.map(serialize) });
}

export async function POST(request: Request) {
  const gate = await requireApiCustomer();
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, addressInputSchema, "Address is invalid");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await saveAddress(gate.ctx.customer.id, parsed.data);
    return NextResponse.json(
      { ok: true, created: result.created, deduped: result.deduped, address: serialize(result.address) },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof DomainRuleError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
