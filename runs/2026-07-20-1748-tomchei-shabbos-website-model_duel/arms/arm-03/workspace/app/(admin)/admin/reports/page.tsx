import Link from "next/link";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { seasonPerformance, seasonDrilldown, marginReport } from "@/lib/reports";
import { formatCents } from "@/lib/catalog";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Multi-season performance reports + shipping-margin reconciliation (R-091, UR-003).

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  await requirePermissionPage("reports.view");
  const { season: drillSeasonId } = await searchParams;

  const performance = await seasonPerformance();
  const drillSeason = drillSeasonId ? performance.find((row) => row.seasonId === drillSeasonId) : null;
  const [drilldown, margin] = await Promise.all([
    drillSeason ? seasonDrilldown(drillSeason.seasonId) : null,
    marginReport(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Reports</h1>
        <p className="text-sm text-muted">
          Season performance, drill-downs, and the shipping-margin reconciliation. Downloadable
          datasets live in the <Link className="text-brand hover:underline" href="/admin/exports">export center</Link>.
        </p>
      </div>

      <Card>
        <CardTitle>Season performance</CardTitle>
        <table className="w-full text-sm" data-testid="season-performance">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="py-1.5 pr-2">Season</th>
              <th className="py-1.5 pr-2">Orders</th>
              <th className="py-1.5 pr-2">Items</th>
              <th className="py-1.5 pr-2">Fees</th>
              <th className="py-1.5 pr-2">Donations</th>
              <th className="py-1.5 pr-2">Billed</th>
              <th className="py-1.5 pr-2">Collected</th>
              <th className="py-1.5 pr-2">Paid / unpaid</th>
              <th className="py-1.5 pr-2">Packages</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {performance.map((row) => (
              <tr key={row.seasonId} className="border-b border-border/60">
                <td className="py-1.5 pr-2 font-medium">
                  {row.seasonName}{" "}
                  <Badge tone={row.seasonStatus === "OPEN" ? "brand" : "neutral"}>{row.seasonStatus}</Badge>
                </td>
                <td className="py-1.5 pr-2">{row.finalizedOrders}</td>
                <td className="py-1.5 pr-2">{formatCents(row.itemsCents)}</td>
                <td className="py-1.5 pr-2">{formatCents(row.feesCents)}</td>
                <td className="py-1.5 pr-2">{formatCents(row.donationCents)}</td>
                <td className="py-1.5 pr-2">{formatCents(row.totalCents)}</td>
                <td className="py-1.5 pr-2">{formatCents(row.collectedCents)}</td>
                <td className="py-1.5 pr-2">{row.paidOrders} / {row.unpaidOrders}</td>
                <td className="py-1.5 pr-2">{row.packages}</td>
                <td className="py-1.5">
                  <Link className="text-brand hover:underline" href={`/admin/reports?season=${row.seasonId}`}>
                    Drill down
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {drillSeason && drilldown && (
        <Card data-testid="season-drilldown">
          <CardTitle>{drillSeason.seasonName} — drill-down</CardTitle>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold mb-2">By fulfillment method</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-border">
                    <th className="py-1 pr-2">Method</th>
                    <th className="py-1 pr-2">Packages</th>
                    <th className="py-1 pr-2">Done</th>
                    <th className="py-1">Line revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.methods.map((row) => (
                    <tr key={row.methodName} className="border-b border-border/60">
                      <td className="py-1 pr-2">{row.methodName}</td>
                      <td className="py-1 pr-2">{row.packages}</td>
                      <td className="py-1 pr-2">{row.delivered}</td>
                      <td className="py-1">{formatCents(row.lineRevenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Item sales</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-border">
                    <th className="py-1 pr-2">Product</th>
                    <th className="py-1 pr-2">Qty</th>
                    <th className="py-1">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.items.map((row) => (
                    <tr key={row.productName} className="border-b border-border/60">
                      <td className="py-1 pr-2">{row.productName}</td>
                      <td className="py-1 pr-2">{row.quantity}</td>
                      <td className="py-1">{formatCents(row.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      <Card data-testid="margin-report">
        <CardTitle>Shipping margin reconciliation</CardTitle>
        <p className="text-sm text-muted mb-3">
          Charged = what the customer paid at checkout (highest carrier&apos;s best rate); cost = the
          label we actually bought. The spread funds the operation and must reconcile per season.
        </p>
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="py-1 pr-2">Season</th>
              <th className="py-1 pr-2">Labels</th>
              <th className="py-1 pr-2">Charged</th>
              <th className="py-1 pr-2">Cost</th>
              <th className="py-1">Margin</th>
            </tr>
          </thead>
          <tbody>
            {margin.totals.length === 0 && (
              <tr><td colSpan={5} className="py-2 text-muted">No purchased labels yet.</td></tr>
            )}
            {margin.totals.map((row) => (
              <tr key={row.seasonName} className="border-b border-border/60" data-testid="margin-season-total">
                <td className="py-1 pr-2 font-medium">{row.seasonName}</td>
                <td className="py-1 pr-2">{row.shipments}</td>
                <td className="py-1 pr-2">{formatCents(row.chargedCents)}</td>
                <td className="py-1 pr-2">{formatCents(row.costCents)}</td>
                <td className="py-1 font-medium">{formatCents(row.marginCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="text-sm font-semibold mb-2">Per label (latest {margin.rows.length})</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="py-1 pr-2">Order</th>
              <th className="py-1 pr-2">Recipient</th>
              <th className="py-1 pr-2">Carrier / service</th>
              <th className="py-1 pr-2">Charged</th>
              <th className="py-1 pr-2">Cost</th>
              <th className="py-1">Margin</th>
            </tr>
          </thead>
          <tbody>
            {margin.rows.map((row) => (
              <tr key={row.shipmentId} className="border-b border-border/60">
                <td className="py-1 pr-2">{row.orderNumber ? `#${row.orderNumber}` : "—"}</td>
                <td className="py-1 pr-2">{row.recipientName}</td>
                <td className="py-1 pr-2">{row.carrier} {row.service}</td>
                <td className="py-1 pr-2">{formatCents(row.chargedCents)}</td>
                <td className="py-1 pr-2">{formatCents(row.costCents)}</td>
                <td className="py-1">{formatCents(row.marginCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
