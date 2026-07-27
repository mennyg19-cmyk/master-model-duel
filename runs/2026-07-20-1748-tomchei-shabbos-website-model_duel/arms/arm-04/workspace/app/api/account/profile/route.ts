import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { normalizePhone } from "@/lib/customers";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().max(30).nullable().optional(),
});

// Ownership enforcement (R-042, R-114): the row updated is always the session
// customer's own — no customer id is read from the request.
export async function PATCH(request: Request) {
  const customer = await getCustomerContext();
  if (!customer) {
    return Response.json({ error: "Sign in to update your profile" }, { status: 401 });
  }

  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const phone = parsed.data.phone ?? null;
  try {
    const updated = await db.customer.update({
      where: { id: customer.id },
      data: { name: parsed.data.name, phone, phoneNormalized: normalizePhone(phone) },
    });
    return Response.json({ ok: true, name: updated.name, phone: updated.phone });
  } catch (error) {
    // phoneNormalized is unique across customers (dedupe rule R-144).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "That phone number belongs to another account" }, { status: 409 });
    }
    throw error;
  }
}
