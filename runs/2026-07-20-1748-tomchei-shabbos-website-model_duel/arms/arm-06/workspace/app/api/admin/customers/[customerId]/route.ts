import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { normalizeWhitespace } from "@/lib/text";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).nullish(),
});

// R-062: customer detail edit (name/phone). Email is the dedupe anchor and
// stays immutable here — changing identity is a merge flow, not an edit.
export async function PATCH(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { customerId } = await params;
  const parsed = await parseBody(request, patchSchema, "Nothing to update");
  if (!parsed.ok) return parsed.response;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const phone = parsed.data.phone === undefined ? undefined : parsed.data.phone || null;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.customer.update({
        where: { id: customerId },
        data: {
          ...(parsed.data.name !== undefined ? { name: normalizeWhitespace(parsed.data.name) } : {}),
          ...(phone !== undefined ? { phone, normalizedPhone: phone ? normalizePhone(phone) : null } : {}),
        },
      });
      await recordAudit(
        {
          ctx: gate.ctx,
          action: "customer_update",
          targetType: "Customer",
          targetId: customerId,
          metadata: {
            before: { name: customer.name, phone: customer.phone },
            after: { name: row.name, phone: row.phone },
          },
        },
        tx,
      );
      return row;
    });
    return NextResponse.json({
      customer: { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone },
    });
  } catch (error) {
    // A phone already owned by another customer collides on the unique index —
    // report it as a conflict, not a 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Another customer already uses that phone number" }, { status: 409 });
    }
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
