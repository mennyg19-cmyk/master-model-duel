import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCurrency } from "@/lib/currency";
import { db } from "@/lib/db";
import { getAvailableQuantity } from "@/lib/storefront";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const product = await db.product.findFirst({
    where: { id: productId, kind: "PACKAGE", isActive: true },
    include: {
      season: true,
      options: { where: { isActive: true }, orderBy: { priceAdjustmentCents: "asc" } },
      inventoryItem: true,
    },
  });
  if (!product) notFound();

  const availableQuantity = getAvailableQuantity(product);
  const isAvailable = availableQuantity === null || availableQuantity > 0;
  const canOrder = product.season.status === "OPEN" && isAvailable;

  return (
    <main className="mx-auto max-w-7xl px-5 py-12 sm:py-20">
      <Link className="text-sm font-bold text-[var(--brand)]" href="/catalog">
        ← Back to collection
      </Link>
      <div className="mt-8 grid gap-12 lg:grid-cols-2">
        <div className="grid min-h-[28rem] place-items-center rounded-[2.5rem] bg-[var(--brand-soft)] p-10">
          <Image
            alt={`${product.name} Purim package`}
            className="h-auto max-h-[28rem] w-full object-contain"
            height={600}
            priority
            src={product.imageUrl ?? "/purim-ribbon.svg"}
            width={720}
          />
        </div>
        <div className="self-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
            {product.category}
          </p>
          <h1 className="mt-3 text-5xl font-black tracking-[-0.04em]">{product.name}</h1>
          <p className="mt-5 text-2xl font-bold">{formatCurrency(product.priceCents)}</p>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">
            {product.description}
          </p>
          {product.options.length > 0 && (
            <fieldset className="mt-8">
              <legend className="font-bold">Choose an option</legend>
              <div className="mt-3 grid gap-3">
                {product.options.map((option) => (
                  <label
                    className="flex cursor-pointer items-center justify-between rounded-2xl border border-[var(--border)] p-4 has-checked:border-[var(--brand)] has-checked:bg-[var(--brand-soft)]"
                    key={option.id}
                  >
                    <span className="flex items-center gap-3">
                      <input defaultChecked={option.isDefault} name="option" type="radio" />
                      <span className="font-semibold">{option.value}</span>
                    </span>
                    <span className="text-sm font-bold">
                      {option.priceAdjustmentCents
                        ? `+${formatCurrency(option.priceAdjustmentCents)}`
                        : "Included"}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {canOrder ? (
            <Link
              className="mt-8 block rounded-full bg-[var(--brand)] px-7 py-4 text-center font-bold text-white"
              href={`/order?product=${product.id}`}
            >
              Start an order
            </Link>
          ) : (
            <p className="mt-8 rounded-2xl bg-[var(--surface)] p-5 font-semibold">
              {isAvailable
                ? "This season is closed for ordering."
                : "This gift is sold out for the season."}
            </p>
          )}
          <p className="mt-5 text-sm leading-6 text-[var(--muted)]">
            Every purchase supports food assistance and holiday needs for families in our community.
          </p>
        </div>
      </div>
    </main>
  );
}
