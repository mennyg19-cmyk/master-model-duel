import Link from "next/link";
import Image from "next/image";
import { formatCurrency } from "@/lib/currency";
import { getCurrentSeason } from "@/lib/storefront";

export default async function HomePage() {
  const season = await getCurrentSeason();
  const isOpen = season?.status === "OPEN";
  const featuredProducts = season?.products.slice(0, 3) ?? [];

  return (
    <main>
      <section className="relative overflow-hidden bg-[var(--cream)]">
        <div className="absolute -right-36 -top-44 size-[32rem] rounded-full bg-[var(--brand-soft)] blur-3xl" />
        <div className="mx-auto grid min-h-[42rem] max-w-7xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="relative z-10">
            <p className="inline-flex rounded-full border border-[var(--brand)]/20 bg-white px-4 py-2 text-sm font-bold text-[var(--brand-dark)]">
              Purim {season?.year ?? "collection"} · {isOpen ? "Now open" : "Browse the memories"}
            </p>
            <h1 className="mt-7 max-w-3xl text-5xl font-black leading-[0.98] tracking-[-0.045em] text-[var(--ink)] sm:text-6xl lg:text-7xl">
              Send joy.
              <span className="block font-serif italic text-[var(--brand)]">Share dignity.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">
              Beautiful mishloach manos that bring Purim cheer to your people
              and practical support to local families.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                className="rounded-full bg-[var(--brand)] px-7 py-3.5 font-bold text-white shadow-[0_12px_30px_rgba(143,47,103,0.24)]"
                href={isOpen ? "/catalog" : "/collections"}
              >
                {isOpen ? "Shop the collection" : "Explore past collections"}
              </Link>
              <Link
                className="rounded-full border border-[var(--border)] bg-white px-7 py-3.5 font-bold text-[var(--ink)]"
                href="/#how-it-works"
              >
                How it works
              </Link>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-xl">
            <div className="absolute -left-5 top-8 rounded-2xl bg-white p-4 shadow-xl">
              <p className="text-2xl font-black text-[var(--brand)]">100%</p>
              <p className="text-xs font-semibold text-[var(--muted)]">local impact</p>
            </div>
            <div className="rotate-2 rounded-[2.5rem] bg-white p-4 shadow-[0_30px_90px_rgba(38,31,53,0.16)]">
              <Image
                alt="A festive Purim gift box tied with a pink ribbon"
                className="aspect-[4/3] w-full rounded-[2rem] object-cover"
                height={540}
                priority
                src="/purim-ribbon.svg"
                width={720}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-white" id="impact">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-[var(--border)] px-5 md:grid-cols-4">
          {[
            ["650+", "families supported"],
            ["1,800", "Purim packages"],
            ["140", "volunteers"],
            ["26", "years together"],
          ].map(([number, label]) => (
            <div className="px-4 py-8 text-center" key={label}>
              <p className="text-3xl font-black text-[var(--brand)]">{number}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
              Made to delight
            </p>
            <h2 className="mt-3 text-4xl font-black tracking-tight">This year&apos;s favorites</h2>
          </div>
          <Link className="font-bold text-[var(--brand)]" href="/catalog">
            View the full collection →
          </Link>
        </div>
        <div className="mt-9 grid gap-6 md:grid-cols-3">
          {featuredProducts.map((product, index) => (
            <Link
              className="group overflow-hidden rounded-[2rem] border border-[var(--border)] bg-white"
              href={`/catalog/${product.id}`}
              key={product.id}
            >
              <div className={`grid aspect-[4/3] place-items-center ${index % 2 ? "bg-[#eef0e7]" : "bg-[var(--brand-soft)]"}`}>
                <Image
                  alt=""
                  className="h-3/4 w-3/4 object-contain transition duration-300 group-hover:scale-105"
                  height={360}
                  src={product.imageUrl ?? "/purim-ribbon.svg"}
                  width={480}
                />
              </div>
              <div className="p-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand)]">{product.category}</p>
                <h3 className="mt-2 text-xl font-bold">{product.name}</h3>
                <p className="mt-3 font-bold">{formatCurrency(product.priceCents)}</p>
              </div>
            </Link>
          ))}
          {featuredProducts.length === 0 && (
            <p className="col-span-full rounded-3xl bg-[var(--surface)] p-10 text-center text-[var(--muted)]">
              The next collection is being prepared.
            </p>
          )}
        </div>
      </section>

      <section className="bg-[var(--ink)] text-white" id="how-it-works">
        <div className="mx-auto max-w-7xl px-5 py-20">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand-light)]">
            Simple to send, meaningful to receive
          </p>
          <h2 className="mt-3 text-4xl font-black">Purim joy in three steps</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              ["01", "Choose a gift", "Pick a thoughtfully assembled package for every person on your list."],
              ["02", "Add your people", "Tell us who should receive each gift and write a personal greeting."],
              ["03", "We take it from here", "Our team prepares and coordinates every package with care."],
            ].map(([step, title, description]) => (
              <article className="border-t border-white/20 pt-6" key={step}>
                <p className="font-serif text-3xl italic text-[var(--brand-light)]">{step}</p>
                <h3 className="mt-4 text-xl font-bold">{title}</h3>
                <p className="mt-3 leading-7 text-white/65">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--cream)] px-5 py-20 text-center">
        <p className="font-serif text-5xl text-[var(--brand)]">“</p>
        <blockquote className="mx-auto max-w-3xl text-2xl font-semibold leading-10 text-[var(--ink)] sm:text-3xl">
          The package was beautiful, but knowing it helped another family made
          it the most meaningful gift we sent all Purim.
        </blockquote>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
          A returning community member
        </p>
      </section>
    </main>
  );
}
