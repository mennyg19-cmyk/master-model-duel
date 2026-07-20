import { db } from "@/lib/db";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { addressInputSchema } from "@/lib/addresses/normalize";
import { saveToAddressBook } from "@/lib/addresses/book";

export async function GET() {
  const customer = await getCustomerContext();
  if (!customer) return Response.json({ error: "Sign in to see your address book" }, { status: 401 });
  const addresses = await db.customerAddress.findMany({
    where: { customerId: customer.id },
    orderBy: { updatedAt: "desc" },
  });
  return Response.json({ addresses });
}

export async function POST(request: Request) {
  const customer = await getCustomerContext();
  if (!customer) return Response.json({ error: "Sign in to save addresses" }, { status: 401 });

  const parsed = addressInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid address" }, { status: 400 });
  }

  // Dedupe on the normalized key: saving an address you already have updates
  // the existing entry instead of duplicating it.
  const address = await saveToAddressBook(customer.id, parsed.data);
  return Response.json({ address }, { status: 201 });
}
