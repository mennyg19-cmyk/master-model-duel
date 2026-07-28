import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/parse-body";
import { requireApiCustomer } from "@/lib/customers/session";
import { normalizeEmail, normalizeWhitespace } from "@/lib/text";
import { normalizePhone } from "@/lib/phone";

// R-042: profile management, ownership-enforced — the only customer this
// route can ever touch is the session's own (there is no id parameter).
const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("A valid email is required").max(200),
  phone: z.string().trim().max(40).nullish(),
});

export async function PATCH(request: Request) {
  const gate = await requireApiCustomer();
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, profileSchema, "Profile is invalid");
  if (!parsed.ok) return parsed.response;

  const email = normalizeEmail(parsed.data.email);
  const phone = parsed.data.phone?.trim() || null;
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  try {
    const customer = await prisma.customer.update({
      where: { id: gate.ctx.customer.id },
      data: {
        name: normalizeWhitespace(parsed.data.name),
        email,
        phone,
        // Clearing the phone clears the dedupe arm too; never carry a stale one.
        normalizedPhone: phone ? normalizedPhone : null,
      },
    });
    return NextResponse.json({ ok: true, customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Another account already uses that email or phone number" },
        { status: 409 },
      );
    }
    throw error;
  }
}
