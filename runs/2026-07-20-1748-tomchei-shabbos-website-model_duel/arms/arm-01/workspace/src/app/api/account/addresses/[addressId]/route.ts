import { NextResponse } from "next/server";
import { type AddressInput, validateAddress } from "@/domain/customer-address";
import {
  findAccessibleDraft,
  getAuthenticatedCustomer,
} from "@/lib/customer-access";
import { db } from "@/lib/db";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ addressId: string }> },
) {
  const { addressId } = await context.params;
  const body = (await request.json()) as AddressInput & {
    draftId?: string;
    version?: number;
  };
  const account = await getAuthenticatedCustomer();
  const draft = !account?.customerId && body.draftId
    ? await findAccessibleDraft(request, body.draftId)
    : null;
  const customerId = account?.customerId ?? draft?.customerId;
  if (!customerId) {
    return NextResponse.json({ error: "Address not found." }, { status: 404 });
  }
  if (!Number.isInteger(body.version) || (body.version ?? 0) < 1) {
    return NextResponse.json({ error: "Address version is required." }, { status: 400 });
  }

  try {
    const address = validateAddress(body);
    const updated = await db.customerAddress.updateMany({
      where: { id: addressId, customerId, version: body.version },
      data: { ...address, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      return NextResponse.json({ error: "Address not found." }, { status: 404 });
    }
    return NextResponse.json({
      address: await db.customerAddress.findUnique({ where: { id: addressId } }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Address could not be updated." },
      { status: 400 },
    );
  }
}
