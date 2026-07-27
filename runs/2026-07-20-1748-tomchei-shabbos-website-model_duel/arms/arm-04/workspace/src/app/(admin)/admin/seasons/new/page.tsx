import Link from 'next/link';

import { createSeasonAction } from '../actions';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { db } from '@/lib/db';
import { listSeasonsNewestFirst } from '@/lib/seasons/management';

export const dynamic = 'force-dynamic';

/**
 * The new-season wizard (R-097).
 *
 * One page rather than a stepper: the four decisions fit on a screen, and a
 * stepper would hide the product list behind a Next button on the one screen
 * where the whole point is reading it. Picking a season to copy from reloads
 * the page with its catalogue ticked, so the boxes shown are always the boxes
 * that will be copied.
 */
export default async function NewSeasonPage({
  searchParams,
}: {
  searchParams: Promise<{ copyFrom?: string; problem?: string }>;
}) {
  await requirePermission('seasons.manage');
  const [{ copyFrom, problem }, seasons] = await Promise.all([
    searchParams,
    listSeasonsNewestFirst(),
  ]);

  const sourceId = copyFrom ?? seasons[0]?.id ?? '';
  const source = seasons.find((season) => season.id === sourceId) ?? null;

  const products = source
    ? await db.product.findMany({
        where: { seasonId: source.id },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
    : [];
  const addOnCount = source ? await db.addOn.count({ where: { seasonId: source.id } }) : 0;

  const suggestedYear = (seasons[0]?.year ?? new Date().getFullYear()) + 1;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/seasons" className="text-sm underline underline-offset-4">
          ← Seasons
        </Link>
        <h1 className="text-2xl font-semibold">Start a new season</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          The new season is created closed and with empty shelves. Copying a catalogue brings the
          products and their prices across, not last year&apos;s stock counts.
        </p>
      </header>

      <FlashMessages problem={problem} testIdPrefix="wizard" />

      <Card>
        <CardTitle>Copy from</CardTitle>
        <CardDescription>
          Pick the season to carry forward, then tick what comes with it.
        </CardDescription>

        <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64">
            <Label htmlFor="copyFrom">Season</Label>
            <Select id="copyFrom" name="copyFrom" defaultValue={sourceId}>
              <option value="">Start from nothing</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" data-testid="wizard-load-source">
            Show its catalogue
          </Button>
        </form>
      </Card>

      <form action={createSeasonAction} className="space-y-6" data-testid="wizard-form">
        <input type="hidden" name="copyFromSeasonId" value={sourceId} />

        <Card>
          <CardTitle>The new season</CardTitle>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="year">Year</Label>
              <Input id="year" name="year" type="number" defaultValue={suggestedYear} required />
            </div>
            <div>
              <Label htmlFor="label">Name</Label>
              <Input id="label" name="label" defaultValue={`Purim ${suggestedYear}`} required />
            </div>
          </div>
        </Card>

        <Card data-testid="wizard-catalog">
          <CardTitle>
            Catalogue {source ? `from ${source.label}` : ''} ({products.length})
          </CardTitle>
          <CardDescription>
            Untick anything that is not coming back. A product left behind has no twin next season,
            so point it at its stand-in on the replacement mappings screen.
          </CardDescription>

          {products.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              Nothing to copy. The season will start empty and you can add products in the catalog.
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {products.map((product) => (
                <li key={product.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="productIds"
                      value={product.id}
                      defaultChecked={product.isActive}
                      data-testid="wizard-product"
                    />
                    <span>
                      {product.name} · {formatCents(product.priceCents)}
                      {product.isActive ? '' : ' · retired'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="copyAddOns" defaultChecked={addOnCount > 0} />
              <span>Copy the {addOnCount} add-on{addOnCount === 1 ? '' : 's'} and their product restrictions</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="linkReplacements"
                defaultChecked
                data-testid="wizard-link-replacements"
              />
              <span>Point each copied product at its new twin, so repeat orders follow the chain</span>
            </label>
          </div>
        </Card>

        <Button type="submit" data-testid="wizard-create">
          Create the season
        </Button>
      </form>
    </div>
  );
}
