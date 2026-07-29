import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getOpenSeason } from "@/lib/seasons/queries";
import { FOLLOW_UP_REASONS, FollowUpReason, loadFollowUps } from "@/lib/admin/follow-ups";
import { Card, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

const REASON_LABELS: Record<FollowUpReason, string> = {
  payment: "Unpaid balances",
  pickup: "Unclaimed pickups",
  bulk: "Bulk-scheduled",
};

// R-079: the follow-up call center — one work list per reason with the
// contact details and the one fact the caller needs. Filter via ?reason=.
export default async function AdminFollowUpsPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  await requirePermission("fulfillment.manage");
  const { reason: reasonParam } = await searchParams;
  const reason = FOLLOW_UP_REASONS.includes(reasonParam as FollowUpReason) ? (reasonParam as FollowUpReason) : undefined;
  const openSeason = await getOpenSeason();

  if (!openSeason) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Follow-ups</h1>
        <p className="mt-4 text-sm text-stone-600">No open season.</p>
      </div>
    );
  }

  const rows = await loadFollowUps(openSeason.id, reason);

  return (
    <div data-followups-page>
      <h1 className="text-2xl font-semibold">Follow-ups — {openSeason.name}</h1>
      <p className="mt-3 flex flex-wrap gap-2 text-sm" data-followup-filters>
        <Link
          href="/admin/follow-ups"
          className={`rounded-full px-3 py-1 ${!reason ? "bg-brand-700 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
        >
          All
        </Link>
        {FOLLOW_UP_REASONS.map((candidate) => (
          <Link
            key={candidate}
            href={`/admin/follow-ups?reason=${candidate}`}
            className={`rounded-full px-3 py-1 ${reason === candidate ? "bg-brand-700 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
            data-followup-filter={candidate}
          >
            {REASON_LABELS[candidate]}
          </Link>
        ))}
      </p>

      <Card className="mt-4 p-5">
        <CardTitle>{rows.length} customer(s) to call</CardTitle>
        <ul className="mt-3 flex flex-col gap-2 text-sm" data-followup-list>
          {rows.map((row, index) => (
            <li key={`${row.reason}-${row.ref}-${index}`} className="border-b border-stone-100 pb-2 last:border-none" data-followup-row>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{row.customerName}</span>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{REASON_LABELS[row.reason]}</span>
              </div>
              <p className="text-stone-600">{row.detail}</p>
              <p className="text-xs text-stone-500">
                {row.ref} · {row.customerEmail}
                {row.customerPhone ? ` · ${row.customerPhone}` : ""}
              </p>
            </li>
          ))}
          {rows.length === 0 && <li className="text-stone-500">Nobody to call — every queue is empty.</li>}
        </ul>
      </Card>
    </div>
  );
}
