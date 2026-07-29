import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getOpenSeason } from "@/lib/seasons/queries";
import { loadDoorList, loadPickupPolicy, loadUnclaimedPickups } from "@/lib/pickup/readiness";
import { Card, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Pickup" };
export const dynamic = "force-dynamic";

// UR-010/G-026: the door list (ready packages waiting for handout, oldest
// first — the picked-up stamp is the package board's PICKED_UP advance) and
// the unclaimed report (ready past the policy threshold), which also feeds
// the follow-up call center.
export default async function AdminPickupPage() {
  await requirePermission("fulfillment.manage");
  const openSeason = await getOpenSeason();

  if (!openSeason) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Pickup</h1>
        <p className="mt-4 text-sm text-stone-600">No open season.</p>
      </div>
    );
  }

  const policy = await loadPickupPolicy();
  const [doorList, unclaimed] = await Promise.all([loadDoorList(openSeason.id), loadUnclaimedPickups(openSeason.id, policy)]);

  return (
    <div data-pickup-page>
      <h1 className="text-2xl font-semibold">Pickup — {openSeason.name}</h1>
      <p className="mt-1 text-sm text-stone-600">
        Readiness syncs from inventory (the pickup-expiry cron); unclaimed means ready more than{" "}
        {policy.unclaimedAfterDays} day(s).
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <CardTitle>Door list — {doorList.length} waiting</CardTitle>
          <ul className="mt-3 flex flex-col gap-2 text-sm" data-door-list>
            {doorList.map((pkg) => (
              <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-2" data-door-row={pkg.id}>
                <span>
                  <Link href={`/admin/packages/${pkg.id}`} className="font-medium text-brand-700 hover:underline">
                    {pkg.recipientName}
                  </Link>{" "}
                  <span className="text-stone-500">for {pkg.order.customer.name}</span>
                </span>
                <span className="text-xs text-stone-500">
                  ready {pkg.pickupReadyAt?.toISOString().slice(0, 10)} · {pkg.stage}
                </span>
              </li>
            ))}
            {doorList.length === 0 && <li className="text-stone-500">Nothing waiting at the door.</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <CardTitle>Unclaimed — {unclaimed.length}</CardTitle>
          <ul className="mt-3 flex flex-col gap-2 text-sm" data-unclaimed-list>
            {unclaimed.map((pkg) => (
              <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-2" data-unclaimed-row={pkg.id}>
                <span>
                  <span className="font-medium">{pkg.order.customer.name}</span> — pickup for {pkg.recipientName}
                </span>
                <span className="text-xs text-stone-500">
                  ready since {pkg.pickupReadyAt?.toISOString().slice(0, 10)} · {pkg.order.customer.email}
                  {pkg.order.customer.phone ? ` · ${pkg.order.customer.phone}` : ""}
                </span>
              </li>
            ))}
            {unclaimed.length === 0 && <li className="text-stone-500">No unclaimed pickups.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
