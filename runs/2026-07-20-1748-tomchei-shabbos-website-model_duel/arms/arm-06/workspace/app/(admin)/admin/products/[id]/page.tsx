import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents, formatDelta } from "@/lib/money";
import { ProductImage } from "@/components/product-image";
import { Card, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/app/(admin)/admin/products/product-form";
import { OptionsManager, ManagedOption } from "@/app/(admin)/admin/products/[id]/options-manager";

export const metadata: Metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

// R-065: product detail — edit form, options manager, replacement-link
// editor, and the add-on restriction set.
export default async function EditProductPage({ params }: Props) {
  await requirePermission("catalog.manage");
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      options: { include: { values: { orderBy: { priceDeltaCents: "asc" } } }, orderBy: { name: "asc" } },
      allowedAddOns: true,
      replaces: { select: { id: true, name: true } },
      replacedBy: { select: { id: true, name: true } },
      media: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!product) notFound();

  const [seasons, addOns, otherProducts] = await Promise.all([
    prisma.season.findMany({ orderBy: { name: "desc" } }),
    // Same rule as the create form (active only), plus add-ons already
    // attached so an inactive one stays visible instead of being silently
    // dropped on the next save.
    prisma.addOn.findMany({
      where: { OR: [{ active: true }, { products: { some: { productId: id } } }] },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { id: { not: id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, season: { select: { name: true } } },
    }),
  ]);

  const managedOptions: ManagedOption[] = product.options.map((option) => ({
    name: option.name,
    values: option.values.map((value) => ({
      label: value.label,
      priceDeltaCents: value.priceDeltaCents,
    })),
  }));

  // Replacement links point forward only (P10's repeat-order chain walk):
  // the editor offers products from strictly newer seasons.
  const productSeasonName = seasons.find((season) => season.id === product.seasonId)?.name ?? "";
  const replacementOptions = otherProducts
    .filter((candidate) => candidate.season.name > productSeasonName)
    .map((candidate) => ({ id: candidate.id, name: candidate.name }));

  return (
    <div>
      <Link href={`/admin/products?season=${product.seasonId}`} className="text-sm text-brand-700 hover:underline">
        ← Products
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{product.name}</h1>
        <span className="text-sm text-stone-500">
          {product.slug} · {formatCents(product.basePriceCents)}
        </span>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <section>
          <Card className="p-5">
            <CardTitle className="text-base">Details</CardTitle>
            <ProductForm
              mode="edit"
              seasons={seasons}
              replacementOptions={replacementOptions}
              addOnOptions={addOns}
              initial={{
                id: product.id,
                seasonId: product.seasonId,
                name: product.name,
                description: product.description,
                kind: product.kind,
                basePriceDollars: (product.basePriceCents / 100).toFixed(2),
                category: product.category,
                lengthMm: product.lengthMm,
                widthMm: product.widthMm,
                heightMm: product.heightMm,
                weightGrams: product.weightGrams,
                trackInventory: product.trackInventory,
                allowBackorder: product.allowBackorder,
                active: product.active,
                replacedById: product.replacedById,
                addOnIds: product.allowedAddOns.map((restriction) => restriction.addOnId),
              }}
            />
          </Card>
        </section>

        <section className="flex flex-col gap-6">
          <Card className="p-5">
            <CardTitle className="text-base">Options &amp; pricing</CardTitle>
            <OptionsManager productId={product.id} options={managedOptions} />
          </Card>

          <Card className="p-5">
            <CardTitle className="text-base">Replacement links</CardTitle>
            <dl className="mt-3 text-sm">
              <dt className="font-medium text-stone-700">Replaced by</dt>
              <dd className="mt-1 text-stone-600">
                {product.replacedBy ? product.replacedBy.name : "— (set in Details)"}
              </dd>
              <dt className="mt-3 font-medium text-stone-700">This product replaces</dt>
              <dd className="mt-1 text-stone-600">
                {product.replaces.length === 0
                  ? "— nothing yet"
                  : product.replaces.map((replaced) => replaced.name).join(", ")}
              </dd>
            </dl>
            <p className="mt-3 text-xs text-stone-500">
              Replacement chains feed repeat orders (P10). Deltas shown next to option values:
              {" "}
              {product.options.flatMap((option) =>
                option.values.map((value) => `${option.name}/${value.label} ${formatDelta(value.priceDeltaCents)}`),
              ).join(" · ") || "none"}
            </p>
          </Card>

          <Card className="p-5">
            <CardTitle className="text-base">Photos</CardTitle>
            {product.media.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">
                No photos assigned — use the{" "}
                <Link href="/admin/media" className="text-brand-700 underline">
                  media library
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-3">
                {product.media.map((asset) => (
                  <li key={asset.id}>
                    <ProductImage
                      src={asset.url}
                      alt={asset.filename}
                      className="h-20 w-20 rounded-md border border-stone-200 object-cover"
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
