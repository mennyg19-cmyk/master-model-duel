import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SeasonSelect } from "@/app/(admin)/admin/products/season-select";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ season?: string }>;
}

// R-065: catalog management with season select — defaults to the open season,
// any season's catalog can be listed and edited.
export default async function AdminProductsPage({ searchParams }: Props) {
  await requirePermission("catalog.manage");
  const { season: requestedSeasonId } = await searchParams;

  const seasons = await prisma.season.findMany({ orderBy: { name: "desc" } });
  const openSeason = await getOpenSeason();
  const selectedSeason =
    seasons.find((season) => season.id === requestedSeasonId) ?? openSeason ?? seasons[0] ?? null;

  const products = selectedSeason
    ? await prisma.product.findMany({
        where: { seasonId: selectedSeason.id },
        orderBy: { name: "asc" },
        include: { inventoryItem: true, _count: { select: { options: true, media: true } } },
      })
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Products</h1>
        <div className="flex items-center gap-3">
          <SeasonSelect seasons={seasons} selectedSeasonId={selectedSeason?.id ?? null} />
          <Link href="/admin/products/new">
            <Button size="sm">New product</Button>
          </Link>
        </div>
      </div>

      {!selectedSeason ? (
        <p className="mt-8 text-sm text-stone-500">No seasons exist yet.</p>
      ) : products.length === 0 ? (
        <p className="mt-8 text-sm text-stone-500">
          No products in season {selectedSeason.name} yet.
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Price</th>
              <th className="py-2 pr-4">Options</th>
              <th className="py-2 pr-4">Photos</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-stone-100">
                <td className="py-2.5 pr-4 font-medium text-stone-900">{product.name}</td>
                <td className="py-2.5 pr-4 text-stone-600">{product.category ?? "—"}</td>
                <td className="py-2.5 pr-4">{formatCents(product.basePriceCents)}</td>
                <td className="py-2.5 pr-4 text-stone-600">{product._count.options}</td>
                <td className="py-2.5 pr-4 text-stone-600">{product._count.media}</td>
                <td className="py-2.5 pr-4">
                  {product.active ? (
                    <Badge tone="green">Active</Badge>
                  ) : (
                    <Badge tone="stone">Hidden</Badge>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <Link href={`/admin/products/${product.id}`} className="text-brand-700 hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
