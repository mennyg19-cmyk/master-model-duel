import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeEmail } from "@/lib/foundation";
import { addStaff, listStaff } from "@/lib/staff-store";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const inviteSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().email(),
  clerkUserId: z.string().trim().min(1).max(100),
  role: z.enum(["MANAGER", "STAFF", "DRIVER"]),
});

export async function GET(request: Request) {
  const authorization = await authorize(request, "staff.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  return NextResponse.json({ staff: await listStaff() });
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "staff.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const parsed = inviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid name, email, Clerk user ID, and role." }, { status: 400 });
  }

  const outcome = await addStaff(
    authorization.staffMember.id,
    parsed.data.clerkUserId,
    parsed.data.displayName,
    normalizeEmail(parsed.data.email),
    parsed.data.role,
  );
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 409 });
  return NextResponse.json({ staffMember: outcome.staffMember }, { status: 201 });
}
