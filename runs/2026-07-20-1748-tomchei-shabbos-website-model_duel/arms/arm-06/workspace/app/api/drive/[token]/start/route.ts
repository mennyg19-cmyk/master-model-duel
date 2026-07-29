import { NextResponse } from "next/server";
import { startRoute } from "@/lib/routes/lifecycle";
import { mapDomainError } from "@/lib/http-errors";
import { requireActiveLink } from "../guard";

export const dynamic = "force-dynamic";

// G-030: driver taps "start route". Fires the day-of notification — exactly
// one email + one SMS per affected CUSTOMER, ever; a re-tap (second device,
// retry after a crash) returns alreadyStarted and sends nothing.
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const guard = await requireActiveLink(token);
  if ("response" in guard) return guard.response;

  try {
    const result = await startRoute({ routeId: guard.link.route.id, linkId: guard.link.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
