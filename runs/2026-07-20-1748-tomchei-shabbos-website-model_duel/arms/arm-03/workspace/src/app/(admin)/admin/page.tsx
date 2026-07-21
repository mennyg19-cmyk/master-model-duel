import Link from "next/link";
import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { dashboardKpis, todayWorkQueue } from "@/lib/ops/orders";

function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AdminHomePage() {
  try {
    const ctx = await requireAdminPage("admin.access");
    const [kpis, today] = await Promise.all([dashboardKpis(), todayWorkQueue(12)]);

    return (
      <main className="space-y-6" data-testid="admin-dashboard">
        <header className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Operations hub
          </h1>
          <p className="mt-1 text-sm opacity-80">
            Signed in as {ctx.effectiveStaff.displayName} ({ctx.effectiveStaff.role})
            {ctx.impersonating ? " — impersonation active" : ""}.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="dashboard-kpis">
            <div className="rounded border border-[var(--color-forest)]/10 p-3">
              <p className="text-xs uppercase tracking-wide opacity-60">Placed today</p>
              <p className="text-2xl font-semibold">{kpis.placedToday}</p>
            </div>
            <div className="rounded border border-[var(--color-forest)]/10 p-3">
              <p className="text-xs uppercase tracking-wide opacity-60">Unpaid / partial</p>
              <p className="text-2xl font-semibold">{kpis.unpaidOpen}</p>
            </div>
            <div className="rounded border border-[var(--color-forest)]/10 p-3">
              <p className="text-xs uppercase tracking-wide opacity-60">Paid open</p>
              <p className="text-2xl font-semibold">{kpis.paidOpen}</p>
            </div>
          </div>
        </header>

        <section className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-[var(--color-forest)]">Today queue</h2>
            <Link href="/admin/today" className="text-sm font-semibold text-[var(--color-leaf)]">
              Full queue →
            </Link>
          </div>
          <ul className="divide-y text-sm" data-testid="today-queue-preview">
            {today.length === 0 ? (
              <li className="py-3 opacity-60">No orders in today&apos;s queue.</li>
            ) : (
              today.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/admin/orders/${o.id}`} className="font-semibold underline">
                    #{o.orderNumber ?? "—"} · {o.customer?.displayName ?? "Walk-in"}
                  </Link>
                  <span className="text-xs opacity-70">
                    {o.status} · {o.paymentStatusCached} · {money(o.expectedTotalCents)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-[var(--color-forest)]">Recent orders</h2>
            <Link href="/admin/orders" className="text-sm font-semibold text-[var(--color-leaf)]">
              Search all →
            </Link>
          </div>
          <ul className="divide-y text-sm" data-testid="recent-orders">
            {kpis.recent.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/admin/orders/${o.id}`} className="font-semibold underline">
                  #{o.orderNumber ?? "—"} · {o.customer?.displayName ?? "Guest"}
                </Link>
                <span className="text-xs opacity-70">
                  {o.status} · {o.paymentStatusCached}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    if (error instanceof AuthError && error.status === 401) {
      return (
        <main className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Sign in required</h1>
          <p className="mt-2 text-sm">Use AUTH_MODE=dev session cookie or Clerk sign-in.</p>
          <Link className="mt-4 inline-block underline" href="/admin/setup">
            First-run setup
          </Link>
        </main>
      );
    }
    throw error;
  }
}
