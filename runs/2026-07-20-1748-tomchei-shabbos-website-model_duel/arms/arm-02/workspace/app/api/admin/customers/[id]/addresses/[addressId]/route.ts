import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { addressInputSchema } from "@/lib/addresses/normalize";
import { updateAddressBookEntry } from "@/lib/addresses/book";

// Staff edit of a customer's address book (UR-014, G-019). Same validation and
// dedupe as the customer path, plus an AuditLog row with the before/after
// snapshot, committed atomically with the change.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; addressId: string }> }
) {
  const gate = await requirePermissionApi("customers.manage");
  if ("response" in gate) return gate.response;

  const { id: customerId, addressId } = await params;
  const parsed = addressInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid address" }, { status: 400 });
  }

  const address = await db.customerAddress.findUnique({ where: { id: addressId } });
  if (!address || address.customerId !== customerId) {
    return Response.json({ error: "Address not found for this customer" }, { status: 404 });
  }

  try {
    // Same write path as the customer edit (updateAddressBookEntry recomputes
    // the dedupe key + geocode); the audit row is the only staff-only extra.
    const updated = await db.$transaction(async (tx) => {
      const row = await updateAddressBookEntry(addressId, parsed.data, tx);
      await writeAudit(
        gate.staff,
        {
          action: "customer.address.staff_edit",
          targetType: "CustomerAddress",
          targetId: addressId,
          detail: {
            customerId,
            before: {
              recipient: address.recipient,
              line1: address.line1,
              line2: address.line2,
              city: address.city,
              state: address.state,
              zip: address.zip,
            },
            after: parsed.data,
          },
        },
        tx
      );
      return row;
    });
    return Response.json({ address: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json(
        { error: "The customer already has this exact address saved" },
        { status: 409 }
      );
    }
    throw error;
  }
}
