import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { FOLLOW_UP_REASONS, FollowUpReason, loadFollowUps } from "@/lib/admin/follow-ups";
import { getOpenSeason } from "@/lib/seasons/queries";

export const dynamic = "force-dynamic";

// R-079 follow-up call center: one work list per reason, filterable with
// ?reason=payment|pickup|bulk; no reason returns everything.
export async function GET(request: Request) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });

  const reasonParam = new URL(request.url).searchParams.get("reason");
  const reason = FOLLOW_UP_REASONS.includes(reasonParam as FollowUpReason) ? (reasonParam as FollowUpReason) : undefined;
  if (reasonParam && !reason) {
    return NextResponse.json({ error: `reason must be one of ${FOLLOW_UP_REASONS.join(", ")}` }, { status: 400 });
  }

  try {
    const rows = await loadFollowUps(season.id, reason);
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
