import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isDevAuthBypass } from "@/lib/env";

// Dev/test-only outbox capture (same honesty class as /api/dev/shippo-fixture):
// 404 unless DEV_AUTH_BYPASS=true. Smoke asserts the notification law ("one
// email + one SMS per customer") by reading these rows — no live Resend/
// Twilio keys exist on this host (the provider decision lands in P11).
export async function GET(request: Request) {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const orderId = url.searchParams.get("orderId");
  const messages = await prisma.outboxMessage.findMany({
    where: {
      ...(kind ? { kind } : {}),
      ...(orderId ? { orderId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ ok: true, count: messages.length, messages });
}
