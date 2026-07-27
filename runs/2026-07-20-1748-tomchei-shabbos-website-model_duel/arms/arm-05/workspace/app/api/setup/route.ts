import { NextResponse } from "next/server";
import { z } from "zod";
import { createFirstManager, canBootstrap } from "@/lib/staff-store";
import { authenticate, hasSameOrigin } from "@/lib/route-auth";

const setupSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
});

export async function GET() {
  try {
    return NextResponse.json({ canBootstrap: await canBootstrap() });
  } catch {
    return NextResponse.json({ error: "Database is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const authentication = await authenticate(request, true);
  if (!authentication.ok) {
    return NextResponse.json({ error: authentication.error }, { status: authentication.status });
  }
  if (!authentication.email) {
    return NextResponse.json({ error: "Your signed-in account needs a primary email address." }, { status: 400 });
  }

  const parsed = setupSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid name." }, { status: 400 });

  const outcome = await createFirstManager(
    authentication.userId,
    parsed.data.displayName,
    authentication.email.toLowerCase(),
  );
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 409 });
  return NextResponse.json({ manager: outcome.manager }, { status: 201 });
}
