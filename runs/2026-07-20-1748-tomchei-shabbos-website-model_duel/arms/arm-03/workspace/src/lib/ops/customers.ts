import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { normalizePhone } from "@/lib/phone";
import { err, maskError, ok, type Result } from "@/lib/result";
import { AuditAction, OrderStatus, Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { assertCanMutateDraft } from "@/lib/orders/draft-access";
import { draftInclude, serializeDraft } from "@/lib/orders/drafts";

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
  const phoneNorm = q ? normalizePhone(q) : null;
  const emailNorm = q ? normalizeEmail(q) : null;
  const where = q
    ? {
        OR: [
          { displayName: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
          ...(emailNorm
            ? [{ emailNorm: { contains: emailNorm, mode: "insensitive" as const } }]
            : []),
          ...(phoneNorm ? [{ phoneNorm: { contains: phoneNorm } }] : []),
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
  tx?: Prisma.TransactionClient;
}): Promise<Result<{ customerId: string; created: boolean }>> {
  const client = input.tx ?? db;
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
    const staffCollision = await client.staffUser.findUnique({ where: { email } });
    if (staffCollision) {
      return err("email", "This email belongs to a staff account.");
    }
    const byEmail =
      (await client.customer.findUnique({ where: { emailNorm: email } })) ??
      (await client.customer.findUnique({ where: { email } }));
    if (byEmail) {
      return ok({ customerId: byEmail.id, created: false });
    }
  }

  if (phoneNorm) {
    const byPhone = await client.customer.findFirst({ where: { phoneNorm } });
    if (byPhone) {
      return ok({ customerId: byPhone.id, created: false });
    }
  }

  try {
    if (input.tx) {
      const created = await input.tx.customer.create({
        data: {
          email,
          emailNorm: email,
          phone: input.phone ?? null,
          phoneNorm,
          displayName,
        },
      });
      await writeAudit(
        {
          action: AuditAction.CUSTOMER_UPSERTED,
          actorId: input.staffId,
          meta: { customerId: created.id, created: true, email, phoneNorm },
        },
        input.tx,
      );
      return ok({ customerId: created.id, created: true });
    }

    const created = await db.$transaction(async (tx) => {
      const row = await tx.customer.create({
        data: {
          email,
          emailNorm: email,
          phone: input.phone ?? null,
          phoneNorm,
          displayName,
        },
      });
      await writeAudit(
        {
          action: AuditAction.CUSTOMER_UPSERTED,
          actorId: input.staffId,
          meta: { customerId: row.id, created: true, email, phoneNorm },
        },
        tx,
      );
      return row;
    });
    return ok({ customerId: created.id, created: true });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const again = email
        ? ((await db.customer.findUnique({ where: { emailNorm: email } })) ??
          (await db.customer.findUnique({ where: { email } })))
        : phoneNorm
          ? await db.customer.findFirst({ where: { phoneNorm } })
          : null;
      if (again) return ok({ customerId: again.id, created: false });
      return err("P2002", "Customer already exists.");
    }
    return err(maskError(error), "Could not create customer.");
  }
}

/** Atomic find-or-create + attach to POS draft (B4). */
export async function attachOrCreatePosCustomer(input: {
  draftRef: string;
  staffId: string;
  request: Request;
  customerId?: string;
  displayName?: string;
  email?: string | null;
  phone?: string | null;
}): Promise<
  Result<{
    draft: ReturnType<typeof serializeDraft>;
    customer: {
      id: string;
      displayName: string;
      email: string | null;
      phone: string | null;
    };
    created: boolean;
  }>
> {
  try {
    const { order } = await assertCanMutateDraft(input.draftRef, input.request);
    if (order.status !== OrderStatus.DRAFT) {
      return err("status", "Draft required");
    }

    const result = await db.$transaction(async (tx) => {
      let customerId = input.customerId;
      let created = false;

      if (!customerId) {
        if (!input.displayName?.trim()) {
          return err("name", "Display name is required.");
        }
        const found = await findOrCreateCustomer({
          displayName: input.displayName,
          email: input.email,
          phone: input.phone,
          staffId: input.staffId,
          tx,
        });
        if (!found.ok) return found;
        customerId = found.value.customerId;
        created = found.value.created;
      }

      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) {
        return err("missing", "Customer not found");
      }

      await tx.order.update({
        where: { id: order.id },
        data: { customerId: customer.id, version: { increment: 1 } },
      });

      await writeAudit(
        {
          action: AuditAction.CUSTOMER_UPSERTED,
          actorId: input.staffId,
          meta: {
            orderId: order.id,
            draftRef: input.draftRef,
            customerId: customer.id,
            attached: true,
            created,
          },
        },
        tx,
      );

      const full = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: draftInclude,
      });

      return ok({
        draft: serializeDraft(full),
        customer: {
          id: customer.id,
          displayName: customer.displayName,
          email: customer.email,
          phone: customer.phone,
        },
        created,
      });
    });

    return result;
  } catch (error) {
    return err(maskError(error), "Could not attach customer.");
  }
}

export async function searchCustomersForPos(q: string, limit = 12) {
  const term = q.trim();
  if (term.length < 2) return [];
  const phoneNorm = normalizePhone(term);
  const emailNorm = normalizeEmail(term);
  return db.customer.findMany({
    where: {
      OR: [
        { displayName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { phone: { contains: term, mode: "insensitive" } },
        ...(emailNorm
          ? [{ emailNorm: { contains: emailNorm, mode: "insensitive" as const } }]
          : []),
        ...(phoneNorm ? [{ phoneNorm: { contains: phoneNorm } }] : []),
      ],
    },
    take: Math.min(25, limit),
    orderBy: { displayName: "asc" },
  });
}
