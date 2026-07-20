import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";

const customerSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
});

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? (digits.length === 10 ? `+1${digits}` : `+${digits}`) : null;
}

export async function POST(request: Request) {
  try {
    const session = await requirePermission("admin:view");
    const parsed = customerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || (!parsed.data.email && !parsed.data.phone)) {
      return NextResponse.json({ error: "Name and email or phone are required." }, { status: 400 });
    }
    const emailNormalized = parsed.data.email ? normalizeEmail(parsed.data.email) : null;
    const phoneNormalized = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
    const existing = await db.customer.findFirst({
      where: {
        OR: [
          ...(emailNormalized ? [{ emailNormalized }] : []),
          ...(phoneNormalized ? [{ phoneNormalized }] : []),
        ],
      },
    });
    if (existing) return NextResponse.json({ customer: existing, found: true });
    try {
      const customer = await db.$transaction(async (transaction) => {
        const created = await transaction.customer.create({
          data: {
            displayName: parsed.data.displayName,
            email: parsed.data.email || null,
            emailNormalized,
            phone: parsed.data.phone || null,
            phoneNormalized,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorStaffId: session.actor.id,
            action: "customer.pos_created",
            targetType: "Customer",
            targetId: created.id,
          },
        });
        return created;
      });
      return NextResponse.json({ customer, found: false }, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ error: "Customer was created concurrently; search again." }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
