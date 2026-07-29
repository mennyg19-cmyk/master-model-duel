import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { getMethodDrilldown, getProductDrilldown, getSeasonPerformance } from "@/lib/reports/seasons";
import { getMarginRollup, getMarginRows } from "@/lib/reports/margin";
import { CHANNEL_LABELS } from "@/lib/packages/fulfillment";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

function tabHref(tab: string, params: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return `/admin/reports?${search.toString()}`;
}

// R-091: multi-season performance reports + drill-downs; UR-003: the
// shipping-margin reconciliation view. Server-rendered tabs — the page is a
// read-only ledger, links carry all state.
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("payments.manage");
  const params = await searchParams;
  const tab = typeof params.tab === "string" ? params.tab : "performance";
  const seasonId = typeof params.season === "string" ? params.season : undefined;
  const drill = typeof params.drill === "string" ? params.drill : undefined;

  const seasons = await prisma.season.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Reports</h1>
      <p className="mt-1 text-sm text-stone-500">
        Multi-season performance and the shipping-margin ledger. Revenue counts posted payments only.
      </p>

      <nav className="mt-4 flex gap-2" data-report-tabs>
        {[
          ["performance", "Performance"],
          ["margin", "Shipping margin"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={tabHref(key)}
            data-report-tab={key}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === key ? "bg-brand-900 text-white" : "border border-stone-300 text-stone-700 hover:border-brand-300"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "performance" && <PerformanceTab seasonId={seasonId} drill={drill} />}
      {tab === "margin" && <MarginTab seasonId={seasonId} seasons={seasons} />}
    </div>
  );
}

async function PerformanceTab({ seasonId, drill }: { seasonId?: string; drill?: string }) {
  const rows = await getSeasonPerformance();
  const selected = seasonId ? rows.find((row) => row.seasonId === seasonId) : undefined;
  const methodDrill = selected && drill === "method" ? await getMethodDrilldown(selected.seasonId) : null;
  const productDrill = selected && drill === "product" ? await getProductDrilldown(selected.seasonId) : null;

  return (
    <section className="mt-6" data-report-performance>
      <h2 className="text-lg font-semibold">Season performance</h2>
      <table className="mt-3 w-full border-collapse text-sm" data-season-table>
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-2 pr-4">Season</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4 text-right">Orders</th>
            <th className="py-2 pr-4 text-right">Packages</th>
            <th className="py-2 pr-4 text-right">Revenue</th>
            <th className="py-2 pr-4 text-right">Delivery fees</th>
            <th className="py-2 pr-4 text-right">Avg order</th>
            <th className="py-2 pr-4">Channel mix</th>
            <th className="py-2 pr-4">Drill down</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.seasonId} className="border-b border-stone-100" data-season-row={row.seasonName}>
              <td className="py-2 pr-4 font-medium text-stone-900">{row.seasonName}</td>
              <td className="py-2 pr-4">
                <Badge tone={row.status === "OPEN" ? "green" : "stone"}>{row.status}</Badge>
              </td>
              <td className="py-2 pr-4 text-right" data-cell="orders">{row.finalizedOrders}</td>
              <td className="py-2 pr-4 text-right" data-cell="packages">{row.packages}</td>
              <td className="py-2 pr-4 text-right" data-cell="revenue">{formatCents(row.revenuePostedCents)}</td>
              <td className="py-2 pr-4 text-right">{formatCents(row.deliveryFeesCents)}</td>
              <td className="py-2 pr-4 text-right">{formatCents(row.avgOrderCents)}</td>
              <td className="py-2 pr-4 text-xs text-stone-600">
                {row.channelMix.map((mix) => `${CHANNEL_LABELS[mix.channel]} ${mix.packages}`).join(" · ") || "—"}
              </td>
              <td className="py-2 pr-4 text-xs">
                <Link href={tabHref("performance", { season: row.seasonId, drill: "method" })} className="text-brand-700 hover:underline" data-drill="method">
                  By method
                </Link>{" "}
                <Link href={tabHref("performance", { season: row.seasonId, drill: "product" })} className="text-brand-700 hover:underline" data-drill="product">
                  By product
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {methodDrill && selected && (
        <section className="mt-6" data-method-drill={selected.seasonId}>
          <h3 className="text-base font-semibold">{selected.seasonName} — by fulfillment method</h3>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4">Method</th>
                <th className="py-2 pr-4 text-right">Packages</th>
                <th className="py-2 pr-4 text-right">Delivery fees</th>
                <th className="py-2 pr-4 text-right">Shipping charged</th>
              </tr>
            </thead>
            <tbody>
              {methodDrill.map((row) => (
                <tr key={row.channel} className="border-b border-stone-100" data-method-row={row.channel}>
                  <td className="py-2 pr-4">{CHANNEL_LABELS[row.channel]}</td>
                  <td className="py-2 pr-4 text-right" data-cell="packages">{row.packages}</td>
                  <td className="py-2 pr-4 text-right" data-cell="fees">{formatCents(row.deliveryFeesCents)}</td>
                  <td className="py-2 pr-4 text-right">{formatCents(row.shippedChargedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {productDrill && selected && (
        <section className="mt-6" data-product-drill={selected.seasonId}>
          <h3 className="text-base font-semibold">{selected.seasonName} — by product</h3>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4 text-right">Units</th>
                <th className="py-2 pr-4 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {productDrill.map((row) => (
                <tr key={row.productName} className="border-b border-stone-100" data-product-row={row.productName}>
                  <td className="py-2 pr-4">{row.productName}</td>
                  <td className="py-2 pr-4 text-right" data-cell="units">{row.units}</td>
                  <td className="py-2 pr-4 text-right" data-cell="revenue">{formatCents(row.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </section>
  );
}

async function MarginTab({
  seasonId,
  seasons,
}: {
  seasonId?: string;
  seasons: { id: string; name: string }[];
}) {
  const [rollup, margin] = await Promise.all([getMarginRollup(seasonId), getMarginRows({ seasonId })]);
  const rows = margin.rows;

  return (
    <section className="mt-6" data-report-margin>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stone-500">Season:</span>
        <Link href={tabHref("margin")} data-margin-season="all" className={seasonId ? "text-brand-700 hover:underline" : "font-semibold text-stone-900"}>
          All
        </Link>
        {seasons.map((season) => (
          <Link
            key={season.id}
            href={tabHref("margin", { season: season.id })}
            data-margin-season={season.name}
            className={seasonId === season.id ? "font-semibold text-stone-900" : "text-brand-700 hover:underline"}
          >
            {season.name}
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4" data-margin-rollup>
        {[
          ["Shipments", String(rollup.shipments)],
          ["Charged", formatCents(rollup.chargedCents)],
          ["Label cost", formatCents(rollup.costCents)],
          ["Margin kept", formatCents(rollup.marginCents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-stone-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-stone-900" data-rollup={label.toLowerCase().replace(/\s/g, "-")}>{value}</p>
          </div>
        ))}
      </div>

      {rollup.byCarrier.length > 0 && (
        <table className="mt-4 w-full border-collapse text-sm" data-carrier-table>
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-4">Carrier</th>
              <th className="py-2 pr-4 text-right">Shipments</th>
              <th className="py-2 pr-4 text-right">Charged</th>
              <th className="py-2 pr-4 text-right">Cost</th>
              <th className="py-2 pr-4 text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rollup.byCarrier.map((carrier) => (
              <tr key={carrier.carrier} className="border-b border-stone-100" data-carrier-row={carrier.carrier}>
                <td className="py-2 pr-4">{carrier.carrier}</td>
                <td className="py-2 pr-4 text-right">{carrier.shipments}</td>
                <td className="py-2 pr-4 text-right">{formatCents(carrier.chargedCents)}</td>
                <td className="py-2 pr-4 text-right">{formatCents(carrier.costCents)}</td>
                <td className="py-2 pr-4 text-right">{formatCents(carrier.marginCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mt-6 text-base font-semibold">Per-package ledger</h3>
      <p className="mt-1 text-xs text-stone-500">
        Charged vs paid per package. Only purchased labels count in the totals above — a voided label returns its margin.
      </p>
      <table className="mt-2 w-full border-collapse text-sm" data-margin-table>
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-2 pr-4">Order</th>
            <th className="py-2 pr-4">Season</th>
            <th className="py-2 pr-4">Recipient</th>
            <th className="py-2 pr-4">Carrier</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4 text-right">Charged</th>
            <th className="py-2 pr-4 text-right">Cost</th>
            <th className="py-2 pr-4 text-right">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.shipmentId} className="border-b border-stone-100" data-margin-row={row.shipmentId}>
              <td className="py-2 pr-4">
                <Link href={`/admin/orders/${row.orderId}`} className="text-brand-700 hover:underline">
                  {row.orderLabel}
                </Link>
              </td>
              <td className="py-2 pr-4">{row.seasonName}</td>
              <td className="py-2 pr-4">{row.recipientName}</td>
              <td className="py-2 pr-4 text-xs text-stone-600">
                {row.carrier ?? "—"}
                {row.serviceLevel ? ` · ${row.serviceLevel}` : ""}
              </td>
              <td className="py-2 pr-4">
                <Badge tone={row.status === "PURCHASED" ? "green" : row.status === "VOIDED" ? "stone" : "amber"}>{row.status}</Badge>
              </td>
              <td className="py-2 pr-4 text-right" data-cell="charged">{formatCents(row.chargedCents)}</td>
              <td className="py-2 pr-4 text-right" data-cell="cost">{row.costCents === null ? "—" : formatCents(row.costCents)}</td>
              <td className="py-2 pr-4 text-right" data-cell="margin">{row.marginCents === null ? "—" : formatCents(row.marginCents)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-4 text-center text-stone-500">
                No shipments yet for this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {margin.truncated && (
        <p className="mt-1 text-xs text-stone-500">
          Showing the newest {margin.take} shipments — this list is capped; narrow by season to see the rest.
        </p>
      )}
    </section>
  );
}
