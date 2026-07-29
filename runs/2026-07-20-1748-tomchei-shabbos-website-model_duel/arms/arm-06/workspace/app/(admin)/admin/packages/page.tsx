import type { Metadata } from "next";
import Link from "next/link";
import { FulfillmentChoice, PackageStage } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { buildListHref, clampPage, LIST_PAGE_SIZES, pageCount } from "@/lib/admin/order-list";
import { buildPackageWhere, parsePackageBoardParams } from "@/lib/packages/board";
import { CHANNEL_LABELS } from "@/lib/packages/fulfillment";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { PackageStageBadge } from "@/components/admin/order-badges";

export const metadata: Metadata = { title: "Packages" };
export const dynamic = "force-dynamic";

// UR-001/G-004: the staff package board — every physical package in the open
// season with stage/channel filters and bounded pagination (G-024). Row
// actions (split, regroup, advance) live on the detail page.
export default async function AdminPackagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("fulfillment.manage");
  const openSeason = await getOpenSeason();
  const params = parsePackageBoardParams(await searchParams);

  if (!openSeason) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Packages</h1>
        <p className="mt-4 text-sm text-stone-600">No open season — packages appear once orders finalize.</p>
      </div>
    );
  }

  const where = buildPackageWhere(openSeason.id, params);
  const total = await prisma.package.count({ where });
  const page = clampPage(params.page, total, params.pageSize);
  const packages = await prisma.package.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.pageSize,
    skip: (page - 1) * params.pageSize,
    select: {
      id: true,
      recipientName: true,
      channel: true,
      deliveryDay: true,
      greeting: true,
      stage: true,
      fulfillmentMethod: { select: { label: true } },
      order: { select: { id: true, wireFormat: true } },
      _count: { select: { lines: true } },
    },
  });

  const pages = pageCount(total, params.pageSize);
  const pageHref = (target: number) =>
    buildListHref("/admin/packages", { q: params.q, stage: params.stage, channel: params.channel }, params.pageSize, target);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Packages</h1>

      <form method="GET" action="/admin/packages" className="mt-4 flex flex-wrap items-end gap-3" data-package-filters>
        <div>
          <label htmlFor="q" className="block text-xs font-medium text-stone-600">
            Search
          </label>
          <Input id="q" name="q" defaultValue={params.q ?? ""} placeholder="Recipient, order ref, greeting…" className="mt-1 w-64" />
        </div>
        <div>
          <label htmlFor="stage" className="block text-xs font-medium text-stone-600">
            Stage
          </label>
          <Select id="stage" name="stage" defaultValue={params.stage ?? ""} className="mt-1">
            <option value="">All</option>
            {Object.values(PackageStage).map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="channel" className="block text-xs font-medium text-stone-600">
            Channel
          </label>
          <Select id="channel" name="channel" defaultValue={params.channel ?? ""} className="mt-1">
            <option value="">All</option>
            {Object.values(FulfillmentChoice).map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="size" className="block text-xs font-medium text-stone-600">
            Page size
          </label>
          <Select id="size" name="size" defaultValue={String(params.pageSize)} className="mt-1">
            {LIST_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
          Apply
        </button>
      </form>

      <p className="mt-4 text-sm text-stone-500" data-package-count>
        {total} package{total === 1 ? "" : "s"} — page {page} of {pages}
      </p>

      <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Recipient</th>
              <th className="px-4 py-2.5">Channel</th>
              <th className="px-4 py-2.5">Method</th>
              <th className="px-4 py-2.5">Stage</th>
              <th className="px-4 py-2.5">Lines</th>
              <th className="px-4 py-2.5">Order</th>
            </tr>
          </thead>
          <tbody data-package-rows>
            {packages.map((pkg) => (
              <tr key={pkg.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/packages/${pkg.id}`} className="font-medium text-brand-700 hover:underline" data-package-link>
                    {pkg.recipientName}
                  </Link>
                  {pkg.greeting && <span className="ml-2 text-xs text-stone-500">card</span>}
                  {pkg.deliveryDay && <span className="ml-2 text-xs text-stone-500">{pkg.deliveryDay}</span>}
                </td>
                <td className="px-4 py-2.5">{CHANNEL_LABELS[pkg.channel]}</td>
                <td className="px-4 py-2.5">{pkg.fulfillmentMethod.label}</td>
                <td className="px-4 py-2.5">
                  <PackageStageBadge stage={pkg.stage} />
                </td>
                <td className="px-4 py-2.5">{pkg._count.lines}</td>
                <td className="px-4 py-2.5">
                  <Link href={`/admin/orders/${pkg.order.id}`} className="text-brand-700 hover:underline">
                    {pkg.order.wireFormat ?? "order"}
                  </Link>
                </td>
              </tr>
            ))}
            {packages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-stone-500">
                  No packages match — finalized orders materialize them automatically.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationNav page={page} pages={pages} href={pageHref} dataAttr="data-package-pagination" />
    </div>
  );
}
