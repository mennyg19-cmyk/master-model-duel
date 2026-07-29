import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { startRoute } from "@/lib/routes/lifecycle";

export const dynamic = "force-dynamic";

// G-030 printed fallback, start half: the driver walked out with the paper
// manifest (no phone at all), so the office starts the run on their behalf —
// same day-of notification law, same idempotency, via staff instead of a link.
export async function POST(_request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;

  try {
    const result = await startRoute({ routeId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
