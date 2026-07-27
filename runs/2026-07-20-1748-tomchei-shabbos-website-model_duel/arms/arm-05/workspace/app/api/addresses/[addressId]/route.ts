import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { addressSchema, findCustomerForRequest, updateCustomerAddress } from "@/lib/order-builder";
import { maskError } from "@/lib/foundation";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

type RouteContext = { params: Promise<{ addressId: string }> };
const editSchema = addressSchema.extend({ customerId: z.string().cuid().optional() });

export async function PATCH(request: Request, context: RouteContext) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a complete recipient address." }, { status: 400 });
  const { addressId } = await context.params;
  const customer = await findCustomerForRequest(request);
  const ownAddress = customer
    ? await prisma.address.findFirst({ where: { id: addressId, customerId: customer.customerId } })
    : null;
  const staff = ownAddress ? null : await authorize(request, "customers.write");
  if (!ownAddress && !staff?.ok) {
    return NextResponse.json({ error: "Address not found." }, { status: 404 });
  }
  const address = ownAddress ?? await prisma.address.findUnique({ where: { id: addressId } });
  if (!address) return NextResponse.json({ error: "Address not found." }, { status: 404 });
  if (parsed.data.customerId && parsed.data.customerId !== address.customerId) {
    return NextResponse.json({ error: "Address ownership cannot be changed here." }, { status: 400 });
  }
  try {
    const saved = await updateCustomerAddress(
      address.customerId,
      addressId,
      parsed.data,
      staff?.ok ? staff.staffMember.id : undefined,
    );
    return NextResponse.json({ address: saved });
  } catch (error) {
    const message = maskError(error);
    return NextResponse.json(
      { error: message },
      { status: message === "Another saved address already uses these details." ? 409 : 400 },
    );
  }
}
