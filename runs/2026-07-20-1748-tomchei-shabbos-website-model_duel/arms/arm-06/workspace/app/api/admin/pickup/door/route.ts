import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { loadDoorList } from "@/lib/pickup/readiness";
import { getOpenSeason } from "@/lib/seasons/queries";

export const dynamic = "force-dynamic";

// UR-010 door list: ready-for-pickup packages still waiting for handout,
// oldest first — the order the door volunteer works through. The page stamps
// picked-up from the package board's stage advance; this is the read model.
export async function GET() {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });

  try {
    const packages = await loadDoorList(season.id);
    return NextResponse.json({ ok: true, packages });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
