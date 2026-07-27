import Link from 'next/link';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { toursFor } from '@/lib/help/tours';

export const dynamic = 'force-dynamic';

/**
 * The help centre (R-102).
 *
 * A volunteer who is handed a login in Purim week has nobody free to ask, so
 * every screen they can open has a short tour here: when they would be on it and
 * the steps in the order the screen puts them.
 *
 * Only the tours for screens this reader can actually open are listed. Being
 * taught a page that answers 403 is worse than not being taught it.
 */
export default async function HelpCentrePage() {
  const context = await requirePermission('dashboard.view');
  const tours = toursFor(context.permissions);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Help</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          What each screen is for and how to work it. {tours.length} of these apply to you.
        </p>
      </header>

      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="help-contents">
        {tours.map((tour) => (
          <a key={tour.slug} href={`#${tour.slug}`} className="underline underline-offset-4">
            {tour.title}
          </a>
        ))}
      </nav>

      <div className="space-y-4" data-testid="help-centre">
        {tours.map((tour) => (
          <Card key={tour.slug} id={tour.slug} data-testid="help-tour" data-tour={tour.slug}>
            <CardTitle>{tour.title}</CardTitle>
            <CardDescription>{tour.when}</CardDescription>

            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {tour.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <Link
              href={tour.href}
              className="mt-3 inline-block text-sm underline underline-offset-4"
              data-testid="help-open-screen"
            >
              Open the screen
            </Link>
          </Card>
        ))}
      </div>

      <Card>
        <CardTitle>Still stuck</CardTitle>
        <CardDescription>
          Every action you take is written down under your name, so nothing you do here is
          unrecoverable by somebody who can read the audit log. If a screen refuses you, it is a
          permission the office can grant from Staff — it is not a fault.
        </CardDescription>
      </Card>
    </div>
  );
}
