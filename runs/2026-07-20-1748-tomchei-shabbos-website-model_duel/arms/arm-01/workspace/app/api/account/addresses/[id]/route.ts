import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { addressInputSchema } from "@/lib/addresses/normalize";
import { updateAddressBookEntry } from "@/lib/addresses/book";

// Ownership check shared by PATCH and DELETE: the address must belong to the
// session customer. A wrong or foreign id gets the same 404 (no enumeration).
async function findOwnAddress(id: string) {
  const customer = await getCustomerContext();
  if (!customer) return { response: Response.json({ error: "Sign in first" }, { status: 401 }) };
  const address = await db.customerAddress.findUnique({ where: { id } });
  if (!address || address.customerId !== customer.id) {
    return { response: Response.json({ error: "Address not found" }, { status: 404 }) };
  }
  return { address };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = await findOwnAddress(id);
  if ("response" in owned) return owned.response;

  const parsed = addressInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid address" }, { status: 400 });
  }

  try {
    const address = await updateAddressBookEntry(id, parsed.data);
    return Response.json({ address });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "You already have this exact address saved" }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = await findOwnAddress(id);
  if ("response" in owned) return owned.response;
  await db.customerAddress.delete({ where: { id } });
  return Response.json({ ok: true });
}
