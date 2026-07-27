import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { customerSearchWhere, findOrLinkCustomer } from "@/lib/customers";

const SEARCH_LIMIT = 20;

/** Staff customer lookup (R-059, R-062): name/email/phone search, bounded. */
export async function GET(request: Request) {
  const gate = await requirePermissionApi("customers.manage");
  if ("response" in gate) return gate.response;

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return Response.json({ customers: [] });

  const customers = await db.customer.findMany({
    where: customerSearchWhere(q),
    select: { id: true, name: true, email: true, phone: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: SEARCH_LIMIT,
  });
  return Response.json({ customers });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional(),
});

/**
 * Staff find-or-create for walk-ins (R-060, UR-011): reuses the checkout's
 * findOrLinkCustomer so a walk-in with a known email lands on their existing
 * record instead of a duplicate.
 */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("customers.manage");
  if ("response" in gate) return gate.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const before = await db.customer.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  const customer = await findOrLinkCustomer(parsed.data);
  if (!before) {
    await writeAudit(gate.staff, {
      action: "customer.staff_create",
      targetType: "Customer",
      targetId: customer.id,
      detail: { email: customer.email, name: customer.name },
    });
  }
  return Response.json({
    customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
    existed: Boolean(before),
  });
}
