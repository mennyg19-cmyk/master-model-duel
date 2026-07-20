import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCatalogProducts } from "@/lib/catalog";
import { ProductGrid } from "@/components/storefront/product-grid";

/** Browse-only archive of one past season (R-005, G-022) — no checkout, no buy buttons. */
export default async function ArchivedSeasonPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  const season = await db.season.findUnique({ where: { id: seasonId } });
  if (!season || season.status !== "CLOSED") notFound();

  const products = await getCatalogProducts(season.id);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <Link href="/collections" className="text-sm text-brand hover:underline">
        &larr; All past collections
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{season.name}</h1>
      <p className="mt-1 text-muted">Archived collection — for browsing only.</p>
      <div className="mt-6">
        {products.length === 0 ? (
          <p className="py-16 text-center text-muted">This season has no recorded packages.</p>
        ) : (
          <ProductGrid products={products} canOrder={false} />
        )}
      </div>
    </main>
  );
}
