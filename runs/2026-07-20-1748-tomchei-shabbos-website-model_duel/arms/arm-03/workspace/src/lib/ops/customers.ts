import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { normalizePhone } from "@/lib/phone";
import { err, ok, type Result } from "@/lib/result";
import { AuditAction } from "@prisma/client";
import { writeAudit } from "@/lib/audit";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

export async function listCustomers(input: {
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE, Math.max(1, input.pageSize ?? DEFAULT_PAGE));
  const q = input.q?.trim();
  const where = q
    ? {
        OR: [
          { displayName: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
          { emailNorm: { contains: normalizeEmail(q), mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, customers] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      include: { _count: { select: { orders: true, addresses: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    customers,
  };
}

export async function getCustomerDetail(customerId: string) {
  return db.customer.findUnique({
    where: { id: customerId },
    include: {
      addresses: { orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] },
      orders: {
        where: { status: { not: "DISCARDED" } },
        orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
        take: 50,
        include: {
          season: { select: { name: true, year: true } },
          _count: { select: { lines: true, packages: true } },
        },
      },
    },
  });
}

/** POS customer lookup / find-or-create (R-060). */
export async function findOrCreateCustomer(input: {
  email?: string | null;
  phone?: string | null;
  displayName: string;
  staffId: string;
}): Promise<Result<{ customerId: string; created: boolean }>> {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const phoneNorm = input.phone ? normalizePhone(input.phone) : null;
  const displayName = input.displayName.trim();
  if (!displayName) {
    return err("name", "Display name is required.");
  }
  if (!email && !phoneNorm) {
    return err("contact", "Email or phone is required to find or create a customer.");
  }

  if (email) {
    const staffCollision = await db.staffUser.findUnique({ where: { email } });
    if (staffCollision) {
      return err("email", "This email belongs to a staff account.");
    }
    const byEmail =
      (await db.customer.findUnique({ where: { emailNorm: email } })) ??
      (await db.customer.findUnique({ where: { email } }));
    if (byEmail) {
      return ok({ customerId: byEmail.id, created: false });
    }
  }

  if (phoneNorm) {
    const byPhone = await db.customer.findFirst({ where: { phoneNorm } });
    if (byPhone) {
      return ok({ customerId: byPhone.id, created: false });
    }
  }

  const created = await db.customer.create({
    data: {
      email,
      emailNorm: email,
      phone: input.phone ?? null,
      phoneNorm,
      displayName,
    },
  });
  await writeAudit({
    action: AuditAction.CUSTOMER_UPSERTED,
    actorId: input.staffId,
    meta: { customerId: created.id, created: true, email, phoneNorm },
  });
  return ok({ customerId: created.id, created: true });
}

export async function searchCustomersForPos(q: string, limit = 12) {
  const term = q.trim();
  if (term.length < 2) return [];
  return db.customer.findMany({
    where: {
      OR: [
        { displayName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { phone: { contains: term, mode: "insensitive" } },
      ],
    },
    take: Math.min(25, limit),
    orderBy: { displayName: "asc" },
  });
}
