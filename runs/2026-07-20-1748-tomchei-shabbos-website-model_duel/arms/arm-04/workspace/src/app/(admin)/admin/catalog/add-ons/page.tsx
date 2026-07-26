import Link from 'next/link';

import { AddOnForm, EMPTY_ADD_ON } from './add-on-form';
import { SeasonSelectForm } from '@/components/admin/season-select-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AddOnsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  await requirePermission('catalog.manage');
  const { season: requestedSeason } = await searchParams;

  const seasons = await db.season.findMany({ orderBy: { year: 'desc' } });
  if (seasons.length === 0) {
    return <p className="text-[var(--color-ink-muted)]">No season exists yet.</p>;
  }

  const selected =
    seasons.find((season) => String(season.year) === requestedSeason) ??
    seasons.find((season) => season.status === 'OPEN') ??
    seasons[0];

  const [addOns, products] = await Promise.all([
    db.addOn.findMany({
      where: { seasonId: selected.id },
      include: { restrictions: true, inventory: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    db.product.findMany({
      where: { seasonId: selected.id },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const seasonOptions = seasons.map((season) => ({ id: season.id, label: season.label }));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/catalog" className="text-sm underline underline-offset-4">
            ← Catalog
          </Link>
          <h1 className="text-2xl font-semibold">Add-ons</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Extras a customer can attach to a package. Restrict one to the products it belongs with.
          </p>
        </div>

        <SeasonSelectForm
          action="/admin/catalog/add-ons"
          seasons={seasons}
          selectedYear={selected.year}
        />
      </header>

      <section className="space-y-4" data-testid="add-on-list">
        {addOns.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            No add-ons for {selected.label} yet.
          </p>
        ) : (
          addOns.map((addOn) => (
            <Card key={addOn.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>
                  {addOn.name} · {formatCents(addOn.priceCents)}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge tone={addOn.isActive ? 'success' : 'neutral'}>
                    {addOn.isActive ? 'Offered' : 'Hidden'}
                  </Badge>
                  <Badge tone="neutral">
                    {addOn.restrictions.length === 0
                      ? 'every product'
                      : `${addOn.restrictions.length} product${addOn.restrictions.length === 1 ? '' : 's'}`}
                  </Badge>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-sm underline underline-offset-4">Edit</summary>
                <div className="mt-4">
                  <AddOnForm
                    seasons={seasonOptions}
                    seasonId={addOn.seasonId}
                    products={products}
                    values={{
                      addOnId: addOn.id,
                      slug: addOn.slug,
                      name: addOn.name,
                      priceDollars: (addOn.priceCents / 100).toFixed(2),
                      tracksInventory: addOn.tracksInventory,
                      isActive: addOn.isActive,
                      sortOrder: addOn.sortOrder,
                      restrictedToProductIds: addOn.restrictions.map(
                        (restriction) => restriction.productId,
                      ),
                    }}
                    submitLabel="Save add-on"
                  />
                </div>
              </details>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Add an add-on</h2>
        <AddOnForm
          seasons={seasonOptions}
          seasonId={selected.id}
          products={products}
          values={EMPTY_ADD_ON}
          submitLabel="Create add-on"
        />
      </section>
    </div>
  );
}
