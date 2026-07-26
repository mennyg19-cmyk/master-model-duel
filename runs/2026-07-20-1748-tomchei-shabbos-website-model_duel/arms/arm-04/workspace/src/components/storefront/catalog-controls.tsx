import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { catalogHref, CATALOG_SORTS, type CatalogSort } from '@/lib/catalog/browse';

/**
 * Filter and sort are query parameters, so the whole control set is links and a
 * GET form. No client JavaScript, and every state of the grid has its own URL.
 */
export function CatalogControls({
  basePath,
  categories,
  activeCategory,
  activeSort,
  resultCount,
}: {
  basePath: string;
  categories: string[];
  activeCategory: string | null;
  activeSort: CatalogSort;
  resultCount: number;
}) {
  const chipHref = (category: string | null) => catalogHref(basePath, { category, sort: activeSort });

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="category-filters">
          <CategoryChip href={chipHref(null)} isActive={activeCategory === null} label="Everything" />
          {categories.map((category) => (
            <CategoryChip
              key={category}
              href={chipHref(category)}
              isActive={activeCategory === category}
              label={category}
            />
          ))}
        </div>
      ) : (
        <span />
      )}

      <form method="get" action={basePath} className="flex items-end gap-2" data-testid="sort-form">
        {activeCategory ? <input type="hidden" name="category" value={activeCategory} /> : null}
        <label className="text-sm">
          <span className="mb-1 block font-medium">Sort by</span>
          <Select name="sort" defaultValue={activeSort} className="w-56">
            {Object.entries(CATALOG_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        <span className="pb-2 text-sm text-[var(--color-ink-muted)]" data-testid="result-count">
          {resultCount} {resultCount === 1 ? 'item' : 'items'}
        </span>
      </form>
    </div>
  );
}

function CategoryChip({
  href,
  isActive,
  label,
}: {
  href: string;
  isActive: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? 'true' : undefined}
      className={
        isActive
          ? 'rounded-full bg-[var(--color-brand)] px-3 py-1.5 text-sm text-white'
          : 'rounded-full border border-[var(--color-line)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]'
      }
    >
      {label}
    </Link>
  );
}
