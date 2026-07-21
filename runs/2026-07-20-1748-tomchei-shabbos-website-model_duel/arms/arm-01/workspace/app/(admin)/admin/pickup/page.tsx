import { requirePermissionPage } from "@/lib/auth/current-user";
import { getOpenSeason } from "@/lib/season";
import { pickupBoard } from "@/lib/pickup";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PickedUpStampButton, PickupReadySweepButton } from "@/components/admin/pickup-actions";

export default async function PickupPage() {
  await requirePermissionPage("fulfillment.manage");
  const season = await getOpenSeason();
  if (!season) return <p className="text-sm text-muted">No open season.</p>;

  const { board, followupDays } = await pickupBoard(season.id);
  const waiting = board.filter((entry) => !entry.pickupReadyAt && !entry.pickupExpiredAt);
  const ready = board.filter((entry) => entry.pickupReadyAt && !entry.pickupExpiredAt);
  const unclaimed = board.filter((entry) => entry.unclaimed);
  const expired = board.filter((entry) => entry.pickupExpiredAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Pickup door</h1>
        <PickupReadySweepButton />
        <a
          href="/api/admin/pickup/door-list"
          target="_blank"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-brand-soft"
        >
          Print door list
        </a>
      </div>

      <Card>
        <CardTitle>Ready for pickup ({ready.length})</CardTitle>
        {ready.length === 0 ? (
          <p className="text-sm text-muted">Nothing is waiting at the door.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2">Recipient</th>
                <th>Orders</th>
                <th>Customer(s)</th>
                <th>Ready since</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ready.map((entry) => (
                <tr key={entry.id} className="border-b border-border/60" data-testid="pickup-ready-row">
                  <td className="py-2">
                    {entry.recipientName}
                    {entry.unclaimed && <Badge tone="danger" className="ml-2">unclaimed &gt;{followupDays}d</Badge>}
                  </td>
                  <td>{entry.orderRefs.join(", ")}</td>
                  <td>{entry.customers.map((customer) => customer.name).join(", ")}</td>
                  <td className="text-muted">{entry.pickupReadyAt?.toISOString().slice(0, 10)}</td>
                  <td><PickedUpStampButton packageId={entry.id} version={entry.version} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <CardTitle>Waiting on stock ({waiting.length})</CardTitle>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted">Every pickup has its stock.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {waiting.map((entry) => (
              <li key={entry.id}>
                {entry.recipientName} — {entry.items.join(", ")}{" "}
                <span className="text-muted">({entry.orderRefs.join(", ")})</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Unclaimed report</CardTitle>
        <p className="mb-2 text-sm text-muted">
          Ready more than {followupDays} day(s) without a pickup — the call-center list. Expired
          pickups were closed by the nightly cron.
        </p>
        {unclaimed.length === 0 && expired.length === 0 ? (
          <p className="text-sm text-muted">Nothing unclaimed.</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="unclaimed-report">
            {unclaimed.map((entry) => (
              <li key={entry.id}>
                {entry.recipientName} — ready {entry.pickupReadyAt?.toISOString().slice(0, 10)} ·{" "}
                {entry.customers.map((customer) => `${customer.name} (${customer.phone ?? customer.email})`).join(", ")}
              </li>
            ))}
            {expired.map((entry) => (
              <li key={entry.id} className="text-muted">
                {entry.recipientName} — expired {entry.pickupExpiredAt?.toISOString().slice(0, 10)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
