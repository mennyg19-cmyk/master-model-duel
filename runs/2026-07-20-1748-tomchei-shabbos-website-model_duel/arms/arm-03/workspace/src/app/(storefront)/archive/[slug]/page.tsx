import Link from "next/link";
import { CatalogBrowser } from "@/components/storefront/catalog-browser";
import { listCatalogProducts, listCategories, toProductCard } from "@/lib/storefront/catalog";
import { getSeasonBySlug } from "@/lib/storefront/season";
import { SeasonStatus } from "@prisma/client";
import { notFound } from "next/navigation";

export default async function ArchiveSeasonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const season = await getSeasonBySlug(slug);
  if (!season || season.status !== SeasonStatus.CLOSED) notFound();

  const [products, categories] = await Promise.all([
    listCatalogProducts({ seasonId: season.id }),
    listCategories(season.id),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <Link href="/archive" className="text-sm font-semibold text-[var(--color-leaf)]">
        ← All years
      </Link>
      <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl text-[var(--color-forest)]">
        {season.name}
      </h1>
      <p className="mt-2 text-sm" data-testid="archive-browse-only">
        Browse only — no buy buttons in archive mode.
      </p>
      <div className="mt-8">
        <CatalogBrowser
          products={products.map(toProductCard)}
          categories={categories}
          storeOpen={false}
          basePath={`/archive/${season.slug}`}
          archiveMode
        />
      </div>
    </main>
  );
}
