import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { parseBody } from "@/lib/parse-body";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { addressInputSchema, updateAddress } from "@/lib/customers/addresses";

// UR-014/G-019: staff edit a customer's address-book entry, audited with a
// field-level diff. customers.manage (MANAGER + STAFF) gates the route.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ customerId: string; addressId: string }> },
) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { customerId, addressId } = await params;
  const parsed = await parseBody(request, addressInputSchema, "Address is invalid");
  if (!parsed.ok) return parsed.response;

  const before = await prisma.address.findUnique({ where: { id: addressId } });
  if (!before || before.customerId !== customerId) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  try {
    const address = await updateAddress(customerId, addressId, parsed.data);
    const changedFields = (
      ["label", "line1", "line2", "city", "region", "postalCode", "country"] as const
    ).filter((field) => before[field] !== address[field]);

    await recordAudit({
      ctx: gate.ctx,
      action: "address_update",
      targetType: "Address",
      targetId: address.id,
      metadata: {
        customerId,
        changedFields,
        before: Object.fromEntries(changedFields.map((field) => [field, before[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, address[field]])),
      },
    });
    return NextResponse.json({ ok: true, address });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }
    if (error instanceof DomainRuleError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
