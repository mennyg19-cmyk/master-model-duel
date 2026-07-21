import { CatalogBrowser } from "@/components/storefront/catalog-browser";
import { listCatalogProducts, listCategories, toProductCard } from "@/lib/storefront/catalog";
import { getCurrentSeason, isStoreOpen } from "@/lib/storefront/season";

export default async function CatalogPage() {
  const season = await getCurrentSeason();
  if (!season) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">Catalog</h1>
        <p className="mt-2 text-sm">No season configured yet.</p>
      </main>
    );
  }
  const [products, categories] = await Promise.all([
    listCatalogProducts({ seasonId: season.id }),
    listCategories(season.id),
  ]);
  const storeOpen = isStoreOpen(season);

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--color-forest)]">
        {season.name} catalog
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink)]/70">
        {storeOpen ? "Store is open — start an order when ready." : "Browse only while the store is closed."}
      </p>
      <div className="mt-8">
        <CatalogBrowser
          products={products.map(toProductCard)}
          categories={categories}
          storeOpen={storeOpen}
        />
      </div>
    </main>
  );
}
