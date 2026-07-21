import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents, getProductBySlug, isSoldOut, toProductCard } from "@/lib/storefront/catalog";
import { getCurrentSeason, isStoreOpen } from "@/lib/storefront/season";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const season = await getCurrentSeason();
  if (!season) notFound();
  const product = await getProductBySlug(season.id, slug);
  if (!product || !product.isActive) notFound();

  const card = toProductCard(product);
  const storeOpen = isStoreOpen(season);
  const soldOut = isSoldOut(card);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/catalog" className="text-sm font-semibold text-[var(--color-leaf)]">
        ← Back to catalog
      </Link>
      <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl text-[var(--color-forest)]">
        {product.name}
      </h1>
      {product.category ? (
        <p className="mt-1 text-xs uppercase tracking-wide text-[var(--color-ink)]/50">{product.category}</p>
      ) : null}
      <p className="mt-4 text-[var(--color-ink)]/80">{product.description}</p>
      <p className="mt-4 text-xl font-semibold">{formatCents(product.basePriceCents)}</p>
      {soldOut ? (
        <p className="mt-2 font-semibold text-[var(--color-danger)]">Sold out</p>
      ) : null}

      {product.options.length ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Options</h2>
          <ul className="mt-2 space-y-2" data-testid="option-pricing">
            {product.options.map((opt) => (
              <li key={opt.id} className="flex justify-between rounded border border-[var(--color-forest)]/10 bg-white px-3 py-2 text-sm">
                <span>{opt.name}</span>
                <span>{formatCents(product.basePriceCents + opt.priceAdjustmentCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-8">
        {storeOpen && !soldOut ? (
          <Link
            href="/order"
            className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-4 py-2 text-sm font-semibold text-white"
          >
            Start order
          </Link>
        ) : (
          <p className="text-sm text-[var(--color-ink)]/70" data-testid="no-buy-cta">
            Ordering is unavailable for this view.
          </p>
        )}
      </div>
    </main>
  );
}
