import Link from "next/link";
import { brand } from "@/lib/brand";
import { getSetting } from "@/lib/settings";
import {
  DEFAULT_IMPACT,
  DEFAULT_TESTIMONIALS,
  STORE_SETTINGS,
  type ImpactStat,
  type Testimonial,
} from "@/lib/storefront/settings-keys";
import { getCurrentSeason, isStoreOpen } from "@/lib/storefront/season";

export default async function HomePage() {
  const season = await getCurrentSeason();
  const storeOpen = isStoreOpen(season);
  const impact =
    (await getSetting<ImpactStat[]>(STORE_SETTINGS.impactStats)) ?? DEFAULT_IMPACT;
  const testimonials =
    (await getSetting<Testimonial[]>(STORE_SETTINGS.testimonials)) ?? DEFAULT_TESTIMONIALS;

  return (
    <main>
      <section className="relative overflow-hidden border-b border-[var(--color-forest)]/10">
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(45,106,79,0.18),_transparent_55%),linear-gradient(160deg,_#f8f4ec_0%,_#e8efe8_100%)]"
          aria-hidden
        />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 md:py-24">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            Community food support
          </p>
          <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-5xl text-[var(--color-forest)] md:text-6xl">
            {brand.name}
          </h1>
          <p className="max-w-xl text-lg text-[var(--color-ink)]/80">{brand.tagline}</p>
          <div className="flex flex-wrap gap-3">
            {storeOpen ? (
              <Link
                href="/order"
                className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-5 py-2.5 text-sm font-semibold text-white"
                data-testid="home-order-cta"
              >
                Order for {season?.name ?? "this season"}
              </Link>
            ) : (
              <span
                className="rounded-[var(--radius-md)] bg-[var(--color-forest)]/15 px-5 py-2.5 text-sm font-semibold text-[var(--color-forest)]"
                data-testid="home-closed-cta"
              >
                Store closed — browse the catalog
              </span>
            )}
            <Link
              href="/catalog"
              className="rounded-[var(--radius-md)] border border-[var(--color-forest)]/30 px-5 py-2.5 text-sm font-semibold"
            >
              View catalog
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="impact-heading">
        <h2 id="impact-heading" className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Impact
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3" data-testid="impact-bar">
          {impact.map((stat) => (
            <li key={stat.label} className="rounded-[var(--radius-lg)] bg-white p-5 shadow-sm">
              <p className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-leaf)]">{stat.value}</p>
              <p className="mt-1 text-sm text-[var(--color-ink)]/70">{stat.label}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-[var(--color-forest)]/10 bg-white py-12" aria-labelledby="how-heading">
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="how-heading" className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              { step: "1", title: "Choose packages", body: "Browse this season’s mishloach manot and add-ons." },
              { step: "2", title: "Assign recipients", body: "Send to yourself, saved addresses, or new recipients." },
              { step: "3", title: "We deliver with care", body: "Pickup, shipping, or volunteer delivery — dignity first." },
            ].map((item) => (
              <li key={item.step} className="rounded-[var(--radius-lg)] border border-[var(--color-forest)]/10 p-5">
                <p className="text-sm font-semibold text-[var(--color-accent)]">Step {item.step}</p>
                <h3 className="mt-1 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-[var(--color-ink)]/75">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="voices-heading">
        <h2 id="voices-heading" className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Voices from the community
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {testimonials.map((t) => (
            <li key={t.quote} className="rounded-[var(--radius-lg)] bg-white p-5 shadow-sm">
              <blockquote className="text-[var(--color-ink)]/85">&ldquo;{t.quote}&rdquo;</blockquote>
              <p className="mt-3 text-sm font-semibold">
                {t.name}
                {t.role ? <span className="font-normal text-[var(--color-ink)]/60"> — {t.role}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
