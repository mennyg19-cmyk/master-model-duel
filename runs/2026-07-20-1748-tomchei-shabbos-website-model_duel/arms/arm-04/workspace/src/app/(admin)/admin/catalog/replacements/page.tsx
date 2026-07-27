import Link from 'next/link';

import { setMappingAction } from './actions';
import { SeasonSelectForm } from '@/components/admin/season-select-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { listSeasonCatalog, mappingOptions, resolveReplacements } from '@/lib/catalog/replacements';
import { formatCents } from '@/lib/core/money';
import { db } from '@/lib/db';
import { listSeasonsNewestFirst } from '@/lib/seasons/management';

export const dynamic = 'force-dynamic';

/**
 * Where last season's catalogue lands in this one (R-048, G-013).
 *
 * The table answers the question a repeat order will ask before a customer asks
 * it: for every item somebody could have bought last year, what do they get if
 * they press "same as last year" today. A row saying "nothing" is not a bug to
 * hide — it is the work list, and it is counted at the top.
 */
export default async function ReplacementMappingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; notice?: string; problem?: string }>;
}) {
  await requirePermission('catalog.manage');
  const [flash, seasons] = await Promise.all([searchParams, listSeasonsNewestFirst()]);

  const target = seasons.find((season) => season.status === 'OPEN') ?? seasons[0];
  const earlier = seasons.filter((season) => target && season.year < target.year);

  if (!target || earlier.length === 0) {
    return (
      <EmptyState
        message={
          target
            ? `${target.label} is the only season, so nothing needs mapping into it yet.`
            : 'No seasons exist yet.'
        }
      />
    );
  }

  const source =
    earlier.find((season) => String(season.year) === flash.season) ?? earlier[0];

  const [products, catalog] = await Promise.all([
    db.product.findMany({
      where: { seasonId: source.id },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    listSeasonCatalog(target.id),
  ]);
  const [resolutions, options] = await Promise.all([
    resolveReplacements(
      products.map((product) => product.id),
      target.id,
    ),
    mappingOptions(products, catalog),
  ]);

  const unmapped = products.filter(
    (product) => (resolutions.get(product.id)?.kind ?? 'unmapped') === 'unmapped',
  ).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Replacements</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            What a repeat order from {source.label} turns into in {target.label}.
          </p>
        </div>

        <div className="flex items-end gap-4">
          <SeasonSelectForm
            action="/admin/catalog/replacements"
            seasons={earlier}
            selectedYear={source.year}
          />
          <Link href="/admin/catalog" className="pb-2 text-sm underline underline-offset-4">
            Catalog
          </Link>
        </div>
      </header>

      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="replacements" />

      <p className="text-sm text-[var(--color-ink-muted)]" data-testid="replacements-summary">
        {unmapped === 0
          ? `Every ${source.label} item lands somewhere in ${target.label}.`
          : `${unmapped} of ${products.length} ${source.label} items land nowhere. A repeat order will stop and ask about each one.`}
      </p>

      <table className="w-full text-left text-sm" data-testid="replacements-table">
        <thead className="border-b border-[var(--color-line)] text-[var(--color-ink-muted)]">
          <tr>
            <th className="py-2">{source.label} item</th>
            <th className="py-2">Lands on</th>
            <th className="py-2">Mapping</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const resolution = resolutions.get(product.id) ?? { kind: 'unmapped' as const };

            return (
              <tr
                key={product.id}
                className="border-b border-[var(--color-line)] align-top"
                data-testid="replacement-row"
                data-slug={product.slug}
                data-resolution={resolution.kind}
              >
                <td className="py-3">
                  <Link
                    href={`/admin/catalog/${product.id}`}
                    className="underline underline-offset-4"
                  >
                    {product.name}
                  </Link>
                  <span className="block text-xs text-[var(--color-ink-muted)]">
                    {formatCents(product.priceCents)}
                    {product.isActive ? '' : ' · retired'}
                  </span>
                </td>

                <td className="py-3">
                  {resolution.kind === 'unmapped' ? (
                    <Badge tone="warning">Nothing</Badge>
                  ) : (
                    <>
                      <span>{resolution.product.name}</span>
                      <span className="block text-xs text-[var(--color-ink-muted)]">
                        {resolution.kind === 'same'
                          ? 'Same item, still on sale'
                          : `Followed ${resolution.hops} link${resolution.hops === 1 ? '' : 's'}${
                              resolution.viaNames.length > 1
                                ? ` via ${resolution.viaNames.slice(0, -1).join(', ')}`
                                : ''
                            }`}
                      </span>
                    </>
                  )}
                </td>

                <td className="py-3">
                  <form action={setMappingAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="from" value={String(source.year)} />
                    <Select
                      name="replacedByProductId"
                      defaultValue={product.replacedByProductId ?? ''}
                      aria-label={`Replacement for ${product.name}`}
                      className="w-auto min-w-56"
                    >
                      <option value="">No mapping</option>
                      {options.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Replacements</h1>
      <p className="text-sm text-[var(--color-ink-muted)]">{message}</p>
      <Link href="/admin/catalog" className="text-sm underline underline-offset-4">
        Back to the catalog
      </Link>
    </div>
  );
}
