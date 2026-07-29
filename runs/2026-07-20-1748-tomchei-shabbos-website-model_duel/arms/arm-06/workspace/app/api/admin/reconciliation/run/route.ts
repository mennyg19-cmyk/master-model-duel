import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { runReconciliation } from "@/lib/reconcile/matcher";

export const dynamic = "force-dynamic";

// R-093: the run button. Manager/staff with payments.manage trigger a
// reconciliation pass on demand; the cron runs the same matcher unattended.
export async function POST() {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const result = await runReconciliation({ ctx: gate.ctx });
  return NextResponse.json({
    ok: true,
    run: {
      id: result.run.id,
      mode: result.run.mode,
      checked: result.run.checkedCount,
      matched: result.run.matchedCount,
      flagged: result.run.flaggedCount,
    },
    findings: result.findings,
  });
}
