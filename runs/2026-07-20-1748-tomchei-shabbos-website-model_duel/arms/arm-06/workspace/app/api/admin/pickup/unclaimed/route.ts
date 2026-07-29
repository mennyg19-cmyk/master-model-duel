import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { loadPickupPolicy, loadUnclaimedPickups } from "@/lib/pickup/readiness";
import { getOpenSeason } from "@/lib/seasons/queries";

export const dynamic = "force-dynamic";

// G-026 unclaimed report: ready longer than pickup.policy.unclaimedAfterDays
// and still not collected — feeds the follow-up call center.
export async function GET() {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });

  try {
    const policy = await loadPickupPolicy();
    const packages = await loadUnclaimedPickups(season.id, policy);
    return NextResponse.json({ ok: true, policy, packages });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
