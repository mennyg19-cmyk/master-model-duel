import Link from "next/link";
import { getOpenSeason } from "@/lib/season";
import { getCatalogProducts } from "@/lib/catalog";
import { ProductGrid } from "@/components/storefront/product-grid";
import { cn } from "@/lib/cn";

const SORTS = [
  { key: "name", label: "Name" },
  { key: "price-asc", label: "Price: low to high" },
  { key: "price-desc", label: "Price: high to low" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; sort?: string }>;
}) {
  const { category, sort } = await searchParams;
  const season = await getOpenSeason();

  if (!season) {
    return (
      <main className="mx-auto max-w-3xl flex-1 px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold">The store is closed for the season</h1>
        <p className="mt-3 text-muted">
          There&apos;s nothing to buy right now, but you can browse what past seasons looked like.
        </p>
        <Link
          href="/collections"
          className="mt-6 inline-block rounded-md bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-strong"
        >
          Browse past collections
        </Link>
      </main>
    );
  }

  const allProducts = await getCatalogProducts(season.id);
  const categories = [...new Set(allProducts.map((product) => product.category).filter((c): c is string => c !== null))].sort();

  const activeSort: SortKey = SORTS.some((option) => option.key === sort) ? (sort as SortKey) : "name";
  let products = category ? allProducts.filter((product) => product.category === category) : allProducts;
  if (activeSort === "price-asc") products = [...products].sort((a, b) => a.basePriceCents - b.basePriceCents);
  if (activeSort === "price-desc") products = [...products].sort((a, b) => b.basePriceCents - a.basePriceCents);

  const filterHref = (nextCategory: string | null) => {
    const params = new URLSearchParams();
    if (nextCategory) params.set("category", nextCategory);
    if (activeSort !== "name") params.set("sort", activeSort);
    const query = params.toString();
    return query ? `/catalog?${query}` : "/catalog";
  };
  const sortHref = (nextSort: SortKey) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (nextSort !== "name") params.set("sort", nextSort);
    const query = params.toString();
    return query ? `/catalog?${query}` : "/catalog";
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold">{season.name} collection</h1>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={filterHref(null)}
          className={cn(
            "rounded-full border border-border px-3 py-1 text-sm",
            !category ? "bg-brand text-white" : "hover:bg-brand-soft"
          )}
        >
          All
        </Link>
        {categories.map((categoryName) => (
          <Link
            key={categoryName}
            href={filterHref(categoryName)}
            className={cn(
              "rounded-full border border-border px-3 py-1 text-sm",
              category === categoryName ? "bg-brand text-white" : "hover:bg-brand-soft"
            )}
          >
            {categoryName}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-2 text-sm text-muted">
          Sort:
          {SORTS.map((option) => (
            <Link
              key={option.key}
              href={sortHref(option.key)}
              className={cn(
                "rounded px-2 py-0.5",
                activeSort === option.key ? "bg-brand-soft font-medium text-brand-strong" : "hover:underline"
              )}
            >
              {option.label}
            </Link>
          ))}
        </span>
      </div>

      <div className="mt-6">
        {products.length === 0 ? (
          <p className="py-16 text-center text-muted">No products in this category yet.</p>
        ) : (
          <ProductGrid products={products} canOrder />
        )}
      </div>
    </main>
  );
}
