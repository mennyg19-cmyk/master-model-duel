import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { ProductImage } from "@/components/product-image";

export const metadata: Metadata = { title: "Past Collections" };
export const dynamic = "force-dynamic";

// R-005, G-022, UR-008 (browse half): every closed season stays browsable
// off-season — browse only, deliberately no buy controls or prices CTAs.
export default async function PastCollectionsPage() {
  const closedSeasons = await prisma.season.findMany({
    where: { status: "CLOSED" },
    orderBy: { name: "desc" },
    include: {
      products: {
        orderBy: { name: "asc" },
        include: { media: { orderBy: { createdAt: "asc" }, take: 1 } },
      },
    },
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-bold text-stone-900">Past collections</h1>
      <p className="mt-1 text-sm text-stone-600">
        Every year&apos;s catalog, kept for browsing. Ordering opens with the new season.
      </p>

      {closedSeasons.length === 0 ? (
        <p className="mt-10 text-sm text-stone-500">No past seasons yet — this is our first year.</p>
      ) : (
        closedSeasons.map((season) => (
          <section key={season.id} aria-label={`Season ${season.name}`} className="mt-10">
            <h2 className="text-xl font-semibold text-stone-900">Season {season.name}</h2>
            {season.products.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">No catalog entries for this season.</p>
            ) : (
              <ul className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {season.products.map((product) => (
                  <li
                    key={product.id}
                    className="flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="flex h-40 items-center justify-center bg-stone-100 text-stone-300">
                      <ProductImage
                        src={product.media[0]?.url ?? null}
                        alt={product.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-4">
                      {product.category && (
                        <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          {product.category}
                        </span>
                      )}
                      <h3 className="text-base font-semibold text-stone-900">{product.name}</h3>
                      {product.description && <p className="text-sm text-stone-600">{product.description}</p>}
                      <p className="mt-auto pt-2 text-sm font-medium text-stone-500">
                        {formatCents(product.basePriceCents)} · archive
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </main>
  );
}
