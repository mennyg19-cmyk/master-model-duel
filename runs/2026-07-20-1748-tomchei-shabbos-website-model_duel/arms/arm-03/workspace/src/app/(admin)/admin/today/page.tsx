import Link from "next/link";
import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { todayWorkQueue } from "@/lib/ops/orders";

export default async function TodayPage() {
  try {
    await requireAdminPage("admin.access");
    const today = await todayWorkQueue(100);
    return (
      <main className="space-y-4" data-testid="today-queue">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Today work queue
        </h1>
        <ul className="divide-y rounded bg-white shadow-sm">
          {today.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <Link href={`/admin/orders/${o.id}`} className="font-semibold underline">
                #{o.orderNumber ?? "—"} · {o.customer?.displayName ?? "Walk-in"}
              </Link>
              <span className="text-xs opacity-70">
                {o.status} · {o.paymentStatusCached} · {o._count.packages} pkgs
              </span>
            </li>
          ))}
        </ul>
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
