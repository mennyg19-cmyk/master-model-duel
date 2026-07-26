import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageHref, type PageInfo } from '@/lib/admin/list-query';

/**
 * The controls every admin list wears (R-105).
 *
 * They are plain GET forms, so the list's whole state is its URL: a staff member
 * can bookmark "unpaid orders, page 3", send it to a colleague, and the back
 * button does what a back button should. That is also what makes the lists
 * testable over HTTP without a browser.
 */
const PAGE_SIZES = [10, DEFAULT_PAGE_SIZE, 50, MAX_PAGE_SIZE];

export type ListFilterOption = { name: string; label: string; value: string; choices: { value: string; label: string }[] };

export function ListSearch({
  action,
  query,
  placeholder,
  pageSize,
  filters = [],
}: {
  action: string;
  query: string;
  placeholder: string;
  pageSize: number;
  filters?: ListFilterOption[];
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3" data-testid="list-search">
      <div className="w-64">
        <Label htmlFor="list-q">Search</Label>
        <Input id="list-q" name="q" defaultValue={query} placeholder={placeholder} />
      </div>

      {filters.map((filter) => (
        <div key={filter.name} className="w-44">
          <Label htmlFor={`list-${filter.name}`}>{filter.label}</Label>
          <Select id={`list-${filter.name}`} name={filter.name} defaultValue={filter.value}>
            {filter.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>
      ))}

      <div className="w-28">
        <Label htmlFor="list-size">Per page</Label>
        <Select id="list-size" name="size" defaultValue={String(pageSize)}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </div>

      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}

export function Pagination({
  page,
  basePath,
  query,
}: {
  page: PageInfo;
  basePath: string;
  query: Record<string, string>;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 text-sm text-[var(--color-ink-muted)]"
      data-testid="pagination"
      data-page={page.page}
      data-page-count={page.pageCount}
      data-total={page.totalCount}
    >
      <p>
        {page.totalCount === 0
          ? 'Nothing to show'
          : `${page.firstRow.toLocaleString('en-US')}–${page.lastRow.toLocaleString('en-US')} of ${page.totalCount.toLocaleString('en-US')}`}
      </p>

      <div className="flex items-center gap-3">
        <PageLink href={page.previousPage === null ? null : pageHref(basePath, query, page.previousPage)}>
          Previous
        </PageLink>
        <span>
          Page {page.page} of {page.pageCount}
        </span>
        <PageLink href={page.nextPage === null ? null : pageHref(basePath, query, page.nextPage)}>
          Next
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (href === null) return <span className="opacity-40">{children}</span>;

  return (
    <Link href={href} className="underline underline-offset-4" data-testid="page-link">
      {children}
    </Link>
  );
}

/** The way back out of a detail screen, in the same place on every one (R-106). */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="text-sm text-[var(--color-ink-muted)]">
      <Link href={href} className="underline underline-offset-4" data-testid="back-link">
        ← {children}
      </Link>
    </p>
  );
}
