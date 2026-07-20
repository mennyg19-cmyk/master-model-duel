import Image from "next/image";
import { formatCurrency } from "@/lib/currency";
import { getArchivedSeasons } from "@/lib/storefront";

export default async function CollectionsPage() {
  const seasons = await getArchivedSeasons();

  return (
    <main className="mx-auto min-h-[70vh] max-w-7xl px-5 py-14 sm:py-20">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        The archive
      </p>
      <h1 className="mt-3 max-w-3xl text-5xl font-black tracking-[-0.04em] sm:text-6xl">
        Years of joy, gathered here.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
        Browse every past collection. Archived gifts are preserved as memories
        and cannot be ordered.
      </p>
      <div className="mt-14 space-y-16">
        {seasons.map((season) => (
          <section key={season.id}>
            <div className="flex items-end justify-between border-b border-[var(--border)] pb-4">
              <div>
                <p className="text-sm font-bold text-[var(--brand)]">Purim</p>
                <h2 className="text-4xl font-black">{season.year}</h2>
              </div>
              <span className="rounded-full bg-[var(--surface)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Browse only
              </span>
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {season.products.map((product) => (
                <article
                  className="overflow-hidden rounded-3xl border border-[var(--border)] bg-white"
                  key={product.id}
                >
                  <div className="grid aspect-square place-items-center bg-[var(--cream)] p-6">
                    <Image
                      alt=""
                      className="h-full w-full object-contain grayscale-[20%]"
                      height={320}
                      src={product.imageUrl ?? "/purim-ribbon.svg"}
                      width={320}
                    />
                  </div>
                  <div className="p-5">
                    <h3 className="font-bold">{product.name}</h3>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {formatCurrency(product.priceCents)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
        {seasons.length === 0 && (
          <p className="rounded-3xl bg-[var(--surface)] p-12 text-center text-[var(--muted)]">
            Past collections will appear here after their season closes.
          </p>
        )}
      </div>
    </main>
  );
}
