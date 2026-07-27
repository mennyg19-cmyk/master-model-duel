import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getOpenSeason } from "@/lib/season";
import { formatCents, isSoldOut } from "@/lib/catalog";
import { OptionPricing } from "@/components/storefront/option-pricing";
import { Badge } from "@/components/ui/badge";

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const season = await getOpenSeason();
  if (!season) notFound();

  const product = await db.product.findUnique({
    where: { seasonId_slug: { seasonId: season.id, slug } },
    include: { options: { where: { isActive: true } }, inventoryItem: true, image: true },
  });
  if (!product || !product.isActive) notFound();

  const soldOut = isSoldOut(product);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link href="/catalog" className="text-sm text-brand hover:underline">
        &larr; Back to catalog
      </Link>
      <div className="mt-4 grid gap-8 md:grid-cols-2">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image.url}
            alt={product.name}
            className="h-80 w-full rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="flex h-80 items-center justify-center rounded-lg border border-border bg-brand-soft text-6xl" aria-hidden>
            🎁
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          {product.category && <p className="mt-1 text-sm text-muted">{product.category}</p>}
          <p className="mt-2 text-lg font-semibold text-brand-strong">
            From {formatCents(product.basePriceCents)}
          </p>
          {soldOut && <Badge tone="danger" className="mt-2">Sold out</Badge>}
          <p className="mt-4 text-sm text-muted">{product.description ?? "No description yet."}</p>
          <OptionPricing
            basePriceCents={product.basePriceCents}
            options={product.options.map((option) => ({
              id: option.id,
              name: option.name,
              priceAdjustmentCents: option.priceAdjustmentCents,
            }))}
          />
          <p className="mt-6 text-sm text-muted">
            {soldOut
              ? "This package is sold out for the season."
              : "Ordering opens from the order builder — coming in the next release."}
          </p>
          {!soldOut && (
            <Link
              href="/order"
              className="mt-3 inline-block rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
            >
              Start an order
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
