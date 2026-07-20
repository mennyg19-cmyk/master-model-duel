import { LaunchReadinessConsole } from "@/components/launch-readiness-console";
import { getLaunchReports } from "@/domain/launch-reporting";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default async function ReportsPage() {
  await requirePermission("audit:view");
  const [reports, seasons] = await Promise.all([
    getLaunchReports(db),
    db.season.findMany({
      orderBy: { year: "desc" },
      select: { id: true, name: true },
    }),
  ]);
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Launch readiness
      </p>
      <h1 className="mt-2 text-4xl font-black">Reports and reconciliation</h1>
      <p className="mt-3 max-w-3xl text-[var(--muted)]">
        Seasonal performance, package-level shipping spread, audited exports,
        Stripe matching, historical migration, and rehearsal controls.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {reports.seasons.map((season) => (
          <article className="rounded-3xl border border-[var(--border)] bg-white p-6" key={season.seasonId}>
            <h2 className="text-lg font-black">{season.seasonName}</h2>
            <p className="mt-3 text-3xl font-black">{dollars(season.revenueCents)}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {season.orderCount} orders · {season.customerCount} customers ·{" "}
              {dollars(season.donationCents)} donations
            </p>
            <div className="mt-4 border-t border-[var(--border)] pt-4 text-sm">
              {season.fulfillment.map((entry) => (
                <p className="flex justify-between" key={entry.code}>
                  <span>{entry.code.replaceAll("_", " ")}</span>
                  <strong>{entry.packageCount}</strong>
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>

      <section className="mt-8 overflow-hidden rounded-3xl border border-[var(--border)] bg-white">
        <div className="border-b border-[var(--border)] p-6">
          <h2 className="text-xl font-black">Shipping margin</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Customer charge compared with purchased carrier rate for each active label.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                {["Season", "Packages", "Charged", "Purchased", "Margin"].map((heading) => (
                  <th className="px-5 py-3" key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.shippingMargin.totals.map((total) => (
                <tr className="border-t border-[var(--border)]" key={total.seasonId}>
                  <td className="px-5 py-3 font-bold">{total.seasonName}</td>
                  <td className="px-5 py-3">{total.packageCount}</td>
                  <td className="px-5 py-3">{dollars(total.chargedCents)}</td>
                  <td className="px-5 py-3">{dollars(total.purchasedCents)}</td>
                  <td className="px-5 py-3 font-bold text-[var(--brand)]">{dollars(total.marginCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <LaunchReadinessConsole
        isTestConsoleEnabled={
          process.env.NODE_ENV !== "production" &&
          process.env.ENABLE_TEST_AUTH === "true"
        }
        seasons={seasons}
      />
    </div>
  );
}
