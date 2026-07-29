import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { resolveReview } from "@/lib/imports/legacy/cleanup";

// UR-014: a flagged (needsReview) address is resolved by a human confirming
// or correcting it — the flag clears, audited. Corrections go through the
// normal address PATCH first, then this clears the flag.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ customerId: string; addressId: string }> },
) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { customerId, addressId } = await params;
  try {
    await resolveReview({ customerId, addressId, ctx: gate.ctx });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
