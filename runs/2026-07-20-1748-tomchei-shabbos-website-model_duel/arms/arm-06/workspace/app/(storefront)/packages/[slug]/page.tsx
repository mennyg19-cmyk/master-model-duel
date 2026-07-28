import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { availableStock, catalogProductInclude, isSoldOut } from "@/lib/storefront/catalog";
import { formatCents } from "@/lib/money";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { OptionPanel, DetailOption } from "@/app/(storefront)/packages/[slug]/option-panel";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await prisma.product.findUnique({ where: { slug }, select: { name: true } });
  return { title: product?.name ?? "Package" };
}

// R-004: detail page with live option pricing. Only open-season, active
// products are sellable; anything else is a 404 (archive has its own pages).
export default async function PackageDetailPage({ params }: Props) {
  const { slug } = await params;
  const openSeason = await getOpenSeason();
  const product = await prisma.product.findUnique({
    where: { slug },
    include: catalogProductInclude,
  });

  if (!product || !product.active || !openSeason || product.seasonId !== openSeason.id) {
    notFound();
  }

  const soldOut = isSoldOut(product);
  const stock = availableStock(product);
  const options: DetailOption[] = product.options.map((option) => ({
    name: option.name,
    values: option.values.map((value) => ({ label: value.label, priceDeltaCents: value.priceDeltaCents })),
  }));
  const addOns = product.allowedAddOns
    .map((restriction) => restriction.addOn)
    .filter((addOn) => addOn.active)
    .map((addOn) => ({ name: addOn.name, priceCents: addOn.priceCents }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <nav className="text-sm text-stone-500" aria-label="Breadcrumb">
        <Link href="/packages" className="hover:text-brand-700">
          Packages
        </Link>{" "}
        / <span className="text-stone-900">{product.name}</span>
      </nav>

      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="flex h-72 items-center justify-center rounded-lg bg-brand-50 text-brand-200">
          <ProductImage
            src={product.media[0]?.url ?? null}
            alt={product.name}
            className="h-full w-full rounded-lg object-cover"
            glyphSize={72}
          />
        </div>

        <div>
          {product.category && (
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{product.category}</span>
          )}
          <h1 className="mt-1 text-3xl font-bold text-stone-900">{product.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xl font-semibold text-brand-700">{formatCents(product.basePriceCents)}</span>
            {soldOut && <Badge tone="red">Sold out</Badge>}
            {!soldOut && stock !== null && stock <= 10 && <Badge tone="amber">Only {stock} left</Badge>}
          </div>
          {product.description && <p className="mt-4 text-stone-600">{product.description}</p>}

          <OptionPanel
            slug={product.slug}
            basePriceCents={product.basePriceCents}
            options={options}
            addOns={addOns}
            soldOut={soldOut}
          />
        </div>
      </div>
    </main>
  );
}
