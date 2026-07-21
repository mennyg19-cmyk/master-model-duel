import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getOpenSeason } from "@/lib/season";

const IMPACT_STATS = [
  { value: "500+", label: "families supported each year" },
  { value: "12,000", label: "Shabbos meals funded last Purim" },
  { value: "100%", label: "of proceeds go to families in need" },
];

const HOW_IT_WORKS = [
  { step: "1", title: "Pick your packages", detail: "Choose mishloach manos from this year's collection." },
  { step: "2", title: "Tell us who gets them", detail: "Add recipients and greetings; we deliver locally or ship." },
  { step: "3", title: "Families are fed", detail: "Every dollar of profit becomes Shabbos food boxes for local families." },
];

const TESTIMONIALS = [
  { quote: "One order covered all my coworkers and helped a family eat for a month. Easiest mitzvah of my year.", name: "Dini W., Lakewood" },
  { quote: "The baskets are gorgeous and the cause is real. We order for the whole shul list every Purim.", name: "R' Meir S., Toms River" },
  { quote: "I love that the greeting cards are personalized. My mother-in-law still talks about hers.", name: "Chaya G., Jackson" },
];

export default async function HomePage() {
  const openSeason = await getOpenSeason();
  const storeOpen = openSeason !== null;

  return (
    <main className="flex-1">
      <section className="bg-brand text-white">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center">
          <h1 className="text-4xl font-bold sm:text-5xl">{BRAND.tagline}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-brand-soft">
            Order beautiful mishloach manos for friends and family — every package funds
            Shabbos food for local families in need, all year round.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {storeOpen ? (
              <>
                <Link
                  href="/catalog"
                  className="rounded-md bg-white px-5 py-2.5 font-semibold text-brand-strong hover:bg-brand-soft"
                >
                  Shop the {openSeason.name} collection
                </Link>
                <Link
                  href="/order"
                  className="rounded-md border border-white/60 px-5 py-2.5 font-semibold text-white hover:bg-white/10"
                >
                  Start an order
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/collections"
                  className="rounded-md bg-white px-5 py-2.5 font-semibold text-brand-strong hover:bg-brand-soft"
                >
                  Browse past collections
                </Link>
                <a
                  href="#newsletter"
                  className="rounded-md border border-white/60 px-5 py-2.5 font-semibold text-white hover:bg-white/10"
                >
                  Get notified when we open
                </a>
              </>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Our impact" className="border-b border-border bg-surface">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8 text-center sm:grid-cols-3">
          {IMPACT_STATS.map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-bold text-brand-strong">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-5xl px-6 py-14">
        <h2 className="text-center text-2xl font-semibold">How it works</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="rounded-lg border border-border bg-surface p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft font-bold text-brand-strong">
                {item.step}
              </span>
              <h3 className="mt-3 font-semibold">{item.title}</h3>
              <p className="mt-1 text-sm text-muted">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Testimonials" className="bg-brand-soft/50">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="text-center text-2xl font-semibold">What senders say</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {TESTIMONIALS.map((testimonial) => (
              <figure key={testimonial.name} className="rounded-lg border border-border bg-surface p-5">
                <blockquote className="text-sm">&ldquo;{testimonial.quote}&rdquo;</blockquote>
                <figcaption className="mt-3 text-xs font-medium text-muted">{testimonial.name}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section id="newsletter" className="mx-auto max-w-5xl px-6 py-14 text-center">
        {storeOpen ? (
          <>
            <h2 className="text-2xl font-semibold">The {openSeason.name} store is open</h2>
            <p className="mx-auto mt-2 max-w-xl text-muted">
              Order early — popular packages sell out before Purim.
            </p>
            <Link
              href="/catalog"
              className="mt-6 inline-block rounded-md bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-strong"
            >
              Shop now
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold">The store is closed between seasons</h2>
            <p className="mx-auto mt-2 max-w-xl text-muted">
              Join the newsletter in the footer below and we&apos;ll email you the moment next
              season&apos;s collection goes live.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
