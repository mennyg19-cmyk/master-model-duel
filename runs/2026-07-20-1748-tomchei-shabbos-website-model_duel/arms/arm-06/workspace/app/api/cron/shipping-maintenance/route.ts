import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { mapDomainError } from "@/lib/http-errors";
import { sweepShippingMaintenance } from "@/lib/shipping/labels";

export const dynamic = "force-dynamic";

// P8 shipping maintenance sweep: resolve PURCHASING rows stuck past the TTL,
// reconcile async void refunds with the carrier (including void rejections),
// and purge expired quote rows. Same bearer gate as nightly-print.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
  const authorized =
    expected !== null &&
    auth !== null &&
    auth.length === expected.length &&
    timingSafeEqual(Buffer.from(auth, "utf8"), Buffer.from(expected, "utf8"));
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepShippingMaintenance();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
