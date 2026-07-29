import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { sendCampaign } from "@/lib/email/campaigns";

export const dynamic = "force-dynamic";

// R-083/R-178: send (or rerun) a campaign. Idempotent by construction — the
// recipient snapshot's unique [campaignId, subscriberId] key plus per-row
// claims mean SENT recipients are never re-delivered; a rerun only picks up
// new list members and retries failures.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("email.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  try {
    const result = await sendCampaign({ campaignId: id, ctx: gate.ctx });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
