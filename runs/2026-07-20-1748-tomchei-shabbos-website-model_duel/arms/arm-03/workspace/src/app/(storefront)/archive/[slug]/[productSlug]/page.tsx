import Link from "next/link";
import { notFound } from "next/navigation";
import { SeasonStatus } from "@prisma/client";
import { formatCents, getProductBySlug, toProductCard, isSoldOut } from "@/lib/storefront/catalog";
import { getSeasonBySlug } from "@/lib/storefront/season";

export default async function ArchiveProductPage({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}) {
  const { slug, productSlug } = await params;
  const season = await getSeasonBySlug(slug);
  if (!season || season.status !== SeasonStatus.CLOSED) notFound();
  const product = await getProductBySlug(season.id, productSlug);
  if (!product || !product.isActive) notFound();
  const card = toProductCard(product);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link href={`/archive/${season.slug}`} className="text-sm font-semibold text-[var(--color-leaf)]">
        ← {season.name}
      </Link>
      <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl text-[var(--color-forest)]">
        {product.name}
      </h1>
      <p className="mt-4 text-[var(--color-ink)]/80">{product.description}</p>
      <p className="mt-4 text-xl font-semibold">{formatCents(product.basePriceCents)}</p>
      {isSoldOut(card) ? <p className="mt-2 text-sm">Was sold out</p> : null}
      <p className="mt-6 text-sm text-[var(--color-ink)]/70" data-testid="no-buy-cta">
        Archive — ordering unavailable.
      </p>
    </main>
  );
}
