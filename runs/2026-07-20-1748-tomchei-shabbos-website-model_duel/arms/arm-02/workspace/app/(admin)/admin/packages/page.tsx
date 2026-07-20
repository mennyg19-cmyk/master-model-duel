import Link from "next/link";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { getOpenSeason } from "@/lib/season";
import { listPackages, parsePackageListFilters, PACKAGES_PAGE_SIZE } from "@/lib/packages/board";
import { Card } from "@/components/ui/card";
import { PackageBoard } from "@/components/admin/package-board";

/** Staff package board (UR-001, G-003, G-004): split, regroup, stage advance. */
export default async function AdminPackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; method?: string; page?: string }>;
}) {
  await requirePermissionPage("fulfillment.manage");
  const season = await getOpenSeason();
  if (!season) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Packages</h1>
        <p className="mt-3 text-sm text-muted">No season is open — packages live inside a season.</p>
      </div>
    );
  }

  const filters = parsePackageListFilters(await searchParams);
  const [{ total, packages, pageCount }, methods] = await Promise.all([
    listPackages(season.id, filters),
    db.fulfillmentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const queryFor = (page: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.stage) params.set("stage", filters.stage);
    if (filters.methodId) params.set("method", filters.methodId);
    if (page > 1) params.set("page", `${page}`);
    const qs = params.toString();
    return qs ? `/admin/packages?${qs}` : "/admin/packages";
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Packages</h1>
        <p className="text-sm text-muted">
          {total} package{total === 1 ? "" : "s"} · page {filters.page} of {pageCount} ·{" "}
          <Link href="/admin/fulfillment" className="text-brand hover:underline">
            Fulfillment dashboard →
          </Link>
        </p>
      </div>

      <form method="GET" action="/admin/packages" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted">
          Search
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Recipient, street, or city"
            className="mt-1 w-64 rounded-md border border-border bg-white px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col text-xs text-muted">
          Stage
          <select
            name="stage"
            defaultValue={filters.stage ?? ""}
            className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
          >
            <option value="">All</option>
            <option value="NEW">New</option>
            <option value="PRINTED">Printed</option>
            <option value="PACKED">Packed</option>
            <option value="SENT">Sent</option>
            <option value="PICKED_UP">Picked up</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted">
          Channel
          <select
            name="method"
            defaultValue={filters.methodId ?? ""}
            className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm text-ink"
          >
            <option value="">All</option>
            {methods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          Filter
        </button>
        {(filters.q || filters.stage || filters.methodId) && (
          <Link href="/admin/packages" className="px-2 py-1.5 text-sm text-brand hover:underline">
            Clear
          </Link>
        )}
      </form>

      <Card>
        <PackageBoard
          packages={packages.map((entry) => ({
            id: entry.id,
            version: entry.version,
            stage: entry.stage,
            recipientName: entry.recipientName,
            address: `${entry.addressLine1}, ${entry.city} ${entry.zip}`,
            greeting: entry.greeting,
            methodName: entry.fulfillmentMethod.name,
            methodKind: entry.fulfillmentMethod.kind,
            lines: entry.lines.map((line) => ({
              id: line.id,
              quantity: line.quantity,
              productName: line.product.name,
              hasAddOns: line.addOns.length > 0,
              orderId: line.order.id,
              orderRef: line.order.orderNumber ? `#${line.order.orderNumber}` : line.order.draftReference,
            })),
          }))}
        />
      </Card>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {filters.page > 1 && (
            <Link href={queryFor(filters.page - 1)} className="text-brand hover:underline">
              ← Previous
            </Link>
          )}
          <span className="text-muted">
            Showing {(filters.page - 1) * PACKAGES_PAGE_SIZE + (packages.length ? 1 : 0)}–
            {(filters.page - 1) * PACKAGES_PAGE_SIZE + packages.length} of {total}
          </span>
          {filters.page < pageCount && (
            <Link href={queryFor(filters.page + 1)} className="text-brand hover:underline">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
