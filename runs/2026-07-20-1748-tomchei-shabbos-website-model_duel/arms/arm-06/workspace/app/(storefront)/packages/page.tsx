import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { availableStock, catalogProductInclude, isSoldOut } from "@/lib/storefront/catalog";
import { PackagesGrid, GridProduct } from "@/app/(storefront)/packages/packages-grid";

export const metadata: Metadata = { title: "Packages" };
export const dynamic = "force-dynamic";

// R-003: current-season catalog. Products of CLOSED seasons live in the
// archive; an inactive product never appears here.
export default async function PackagesPage() {
  const openSeason = await getOpenSeason();

  if (!openSeason) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-2xl font-bold text-stone-900">Packages</h1>
        <p className="mt-4 max-w-xl text-stone-600">
          Ordering is closed for this season. Browse{" "}
          <Link href="/past-collections" className="font-medium text-brand-700 underline">
            past collections
          </Link>{" "}
          to see what we&apos;ve packed before, and join the mailing list for next year&apos;s
          catalog.
        </p>
      </main>
    );
  }

  const products = await prisma.product.findMany({
    where: { seasonId: openSeason.id, active: true },
    include: catalogProductInclude,
    orderBy: { name: "asc" },
  });

  const gridProducts: GridProduct[] = products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    description: product.description,
    basePriceCents: product.basePriceCents,
    soldOut: isSoldOut(product),
    stock: availableStock(product),
    imageUrl: product.media[0]?.url ?? null,
    options: product.options.map((option) => ({
      name: option.name,
      values: option.values.map((value) => ({
        label: value.label,
        priceDeltaCents: value.priceDeltaCents,
      })),
    })),
  }));

  const categories = Array.from(
    new Set(products.map((product) => product.category).filter((category): category is string => Boolean(category))),
  ).sort();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Season {openSeason.name} packages</h1>
          <p className="mt-1 text-sm text-stone-600">
            Every package supports {`Tomchei Shabbos`} — order for friends, family, and neighbors.
          </p>
        </div>
      </div>
      <PackagesGrid products={gridProducts} categories={categories} />
    </main>
  );
}
