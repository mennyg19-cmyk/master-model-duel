import { CatalogExplorer } from "@/components/catalog-explorer";
import { getAvailableQuantity, getCurrentSeason } from "@/lib/storefront";

export default async function CatalogPage() {
  const season = await getCurrentSeason();
  const isOpen = season?.status === "OPEN";
  const products =
    season?.products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      imageUrl: product.imageUrl,
      priceCents: product.priceCents,
      availableQuantity: getAvailableQuantity(product),
      options: product.options.map((option) => ({
        id: option.id,
        name: option.name,
        value: option.value,
        priceAdjustmentCents: option.priceAdjustmentCents,
      })),
    })) ?? [];

  return (
    <main className="mx-auto min-h-[70vh] max-w-7xl px-5 py-14 sm:py-20">
      <div className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
          Purim {season?.year ?? "collection"}
        </p>
        <h1 className="mt-3 text-5xl font-black tracking-[-0.04em] sm:text-6xl">
          Gifts with heart.
        </h1>
        <p className="mt-5 text-lg leading-8 text-[var(--muted)]">
          Each package is assembled with care, delivered with joy, and helps a
          local family celebrate with dignity.
        </p>
      </div>
      {!isOpen && (
        <p className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--cream)] p-5 font-semibold">
          This season is closed. You can explore every gift, but ordering is unavailable.
        </p>
      )}
      <CatalogExplorer isOpen={isOpen} products={products} />
    </main>
  );
}
