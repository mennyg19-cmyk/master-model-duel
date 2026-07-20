import { NextResponse } from "next/server";
import { type AddressInput, validateAddress } from "@/domain/customer-address";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ addressId: string }> },
) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const { addressId } = await context.params;
    const body = (await request.json()) as AddressInput & { version?: number };
    if (!Number.isInteger(body.version) || (body.version ?? 0) < 1) {
      return NextResponse.json({ error: "Address version is required." }, { status: 400 });
    }
    const address = validateAddress(body);
    const savedAddress = await db.$transaction(async (transaction) => {
      const updated = await transaction.customerAddress.updateMany({
        where: { id: addressId, version: body.version },
        data: { ...address, version: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.effective.id,
          impersonatorId:
            staffSession.actor.id === staffSession.effective.id
              ? null
              : staffSession.actor.id,
          action: "customer.address_updated",
          targetType: "CustomerAddress",
          targetId: addressId,
          metadata: { normalizedKey: address.normalizedKey },
        },
      });
      return transaction.customerAddress.findUnique({ where: { id: addressId } });
    });
    return savedAddress
      ? NextResponse.json({ address: savedAddress })
      : NextResponse.json({ error: "Address not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Address could not be updated." },
      { status: 400 },
    );
  }
}
