import { NextResponse } from "next/server";
import { z } from "zod";
import { StaffRole } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { canManageStaffRole } from "@/lib/permissions";
import { normalizeEmail, normalizeWhitespace } from "@/lib/text";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiPermission("staff.manage");
  if (!gate.ok) return gate.response;

  const staffUsers = await prisma.staffUser.findMany({
    orderBy: { createdAt: "asc" },
    include: { overrides: true },
  });
  return NextResponse.json({ staffUsers });
}

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.nativeEnum(StaffRole),
});

export async function POST(request: Request) {
  const gate = await requireApiPermission("staff.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, createSchema, "Name, valid email, and role are required");
  if (!parsed.ok) return parsed.response;

  if (!canManageStaffRole(gate.ctx.staff.role, parsed.data.role)) {
    return NextResponse.json({ error: "You cannot create an account above your own role" }, { status: 403 });
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = await prisma.staffUser.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "A staff account with that email already exists" }, { status: 409 });
  }

  const staff = await prisma.staffUser.create({
    data: {
      email,
      name: normalizeWhitespace(parsed.data.name),
      role: parsed.data.role,
      status: "PENDING",
      inviteToken: crypto.randomUUID(),
      invitedAt: new Date(),
    },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "staff_create",
    targetType: "StaffUser",
    targetId: staff.id,
    metadata: { role: staff.role },
  });

  return NextResponse.json({ staff, invitePath: `/invite/${staff.inviteToken}` }, { status: 201 });
}
