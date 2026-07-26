import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { HOW_IT_WORKS, IMPACT_STATS, MISSION, TESTIMONIALS } from '@/lib/marketing-content';
import { closedStoreMessage, readStoreState } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

export default async function StorefrontHomePage() {
  const store = await readStoreState();
  const seasonLabel = store.season?.label ?? 'This season';

  return (
    <div className="space-y-16">
      <section className="space-y-4" data-testid="mission">
        <Badge tone={store.isOpen ? 'success' : 'warning'}>
          {store.isOpen ? `${seasonLabel} ordering is open` : closedStoreMessage(store)}
        </Badge>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight">{MISSION.headline}</h1>
        <p className="max-w-2xl text-lg text-[var(--color-ink-muted)]">{MISSION.body}</p>

        <div className="flex flex-wrap gap-3 pt-2">
          {store.isOpen ? (
            <Link
              href="/order"
              className="inline-flex items-center rounded-md bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-brand-strong)]"
              data-testid="home-order-cta"
            >
              Start an order
            </Link>
          ) : null}
          <Link
            href="/collection"
            className="inline-flex items-center rounded-md border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
          >
            {store.isOpen ? 'Browse the collection' : `Browse ${seasonLabel}`}
          </Link>
        </div>
      </section>

      <section
        aria-label="Our impact"
        className="grid gap-4 rounded-[var(--radius-card)] bg-[var(--color-brand-soft)] p-6 sm:grid-cols-3"
        data-testid="impact-bar"
      >
        {IMPACT_STATS.map((stat) => (
          <div key={stat.label}>
            <p className="text-3xl font-semibold text-[var(--color-brand-strong)]">{stat.value}</p>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{stat.label}</p>
          </div>
        ))}
      </section>

      <section className="space-y-4" data-testid="how-it-works">
        <h2 className="text-2xl font-semibold">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full">
                <p className="text-sm font-medium text-[var(--color-accent)]">Step {index + 1}</p>
                <CardTitle className="mt-1">{step.title}</CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4" data-testid="testimonials">
        <h2 className="text-2xl font-semibold">What people say</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {TESTIMONIALS.map((testimonial) => (
            <figure
              key={testimonial.attribution}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-5"
            >
              <blockquote className="text-[var(--color-ink)]">“{testimonial.quote}”</blockquote>
              <figcaption className="mt-3 text-sm text-[var(--color-ink-muted)]">
                {testimonial.attribution}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
