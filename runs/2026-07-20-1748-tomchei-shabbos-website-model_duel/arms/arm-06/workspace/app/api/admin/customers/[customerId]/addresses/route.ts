import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { addressSummary } from "@/lib/customers/addresses";

export const dynamic = "force-dynamic";

// POS builder book panel: the picked customer's saved addresses. Read-only —
// edits stay on the customers.manage PATCH route (UR-014).
export async function GET(_request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const { customerId } = await params;
  const addresses = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ label: "asc" }, { createdAt: "asc" }],
    take: 200,
  });
  return NextResponse.json({
    addresses: addresses.map((address) => ({
      id: address.id,
      label: address.label,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
      summary: addressSummary(address),
    })),
  });
}
