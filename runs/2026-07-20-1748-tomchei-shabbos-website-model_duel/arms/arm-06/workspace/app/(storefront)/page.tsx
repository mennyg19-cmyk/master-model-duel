import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSeasonYear } from "@/lib/seasons/year";
import { Button } from "@/components/ui/button";
import { SubscribeForm } from "@/components/storefront/subscribe-form";

export const dynamic = "force-dynamic";

const HOW_IT_WORKS = [
  {
    title: "Pick your packages",
    body: "Browse this year's catalog and choose packages for friends, family, and neighbors.",
  },
  {
    title: "We pack with care",
    body: "Volunteers assemble every package and print personal greeting cards for each recipient.",
  },
  {
    title: "Delivered for Purim",
    body: "Drivers bring packages door to door across the community, or you can pick up at the shul.",
  },
] as const;

const TESTIMONIALS = [
  {
    quote: "The package arrived right before Purim with a beautiful card. My parents were so touched.",
    name: "Sarah L.",
  },
  {
    quote: "Ordering for our whole block took ten minutes. The delivery route was flawless.",
    name: "Dovid K.",
  },
  {
    quote: "Knowing every package supports Tomchei Shabbos makes it the easiest gift of the year.",
    name: "Miriam R.",
  },
] as const;

// R-001/002/007/008: mission homepage with a live impact bar, store-open-aware
// CTAs (open → browse packages; closed → archive + newsletter).
export default async function HomePage() {
  const openSeason = await getOpenSeason();
  const seasonYear = getSeasonYear(new Date());
  const [packageCount, orderCount, customerCount] = await Promise.all([
    prisma.package.count(),
    prisma.order.count({ where: { status: "FINALIZED" } }),
    prisma.customer.count(),
  ]);

  // Labels say what the counts actually are: packageCount includes NEW/unpacked
  // rows and customerCount includes guests whose drafts never finalized.
  const impactStats = [
    { label: "Packages packed", value: packageCount },
    { label: "Orders fulfilled", value: orderCount },
    { label: "Families reached", value: customerCount },
  ];

  return (
    <main>
      <section className="bg-gradient-to-b from-brand-50 to-stone-50">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 md:py-24">
          <span className="rounded-full bg-accent-100 px-3 py-1 text-sm font-medium text-amber-800">
            {openSeason ? `Season ${openSeason.name} is open` : `Season ${seasonYear} is closed`}
          </span>
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
            {BRAND.productName}: {BRAND.tagline}
          </h1>
          <p className="max-w-xl text-lg text-stone-600">
            Every mishloach manos you send brings a smile to a neighbor and supports{" "}
            {BRAND.orgName}&apos;s year-round work for local families.
          </p>
          <div className="flex flex-wrap gap-3">
            {openSeason ? (
              <>
                <Link href="/packages">
                  <Button size="md">Browse packages</Button>
                </Link>
                <Link href="/past-collections">
                  <Button variant="secondary">Past collections</Button>
                </Link>
              </>
            ) : (
              <>
                <Link href="/past-collections">
                  <Button size="md">Browse past collections</Button>
                </Link>
                <Link href="/packages">
                  <Button variant="secondary">See what&apos;s next</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Community impact" className="border-y border-stone-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3">
          {impactStats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-3xl font-bold text-brand-700">{stat.value.toLocaleString()}</p>
              <p className="mt-1 text-sm font-medium text-stone-600">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="How it works" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold text-stone-900">How it works</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <div key={step.title}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-900">
                {index + 1}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-stone-900">{step.title}</h3>
              <p className="mt-1 text-sm text-stone-600">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Testimonials" className="bg-brand-50">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold text-stone-900">From the community</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((testimonial) => (
              <figure key={testimonial.name} className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
                <blockquote className="text-sm text-stone-700">&ldquo;{testimonial.quote}&rdquo;</blockquote>
                <figcaption className="mt-3 text-sm font-medium text-stone-900">
                  — {testimonial.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Stay in touch" className="mx-auto max-w-6xl px-4 py-16">
        <div className="rounded-lg border border-stone-200 bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-stone-900">
            {openSeason ? "Never miss a deadline" : "Be first to know when ordering opens"}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-stone-600">
            Join the mailing list for new packages, ordering reminders, and community news.
          </p>
          <div className="mt-4">
            <SubscribeForm source="homepage" />
          </div>
        </div>
      </section>
    </main>
  );
}
