/**
 * Paging for every admin list (R-105, G-024).
 *
 * The size comes off a query string, so it is clamped here rather than trusted:
 * at Purim volumes `?size=100000` is the difference between a page and an outage,
 * and there is no screen that wants more rows than a person can read. Every list
 * in the admin reads this, so "bounded" is a property of the helper and not a
 * habit each page has to remember.
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 10_000;

export type PageRequest = { page: number; pageSize: number; skip: number; take: number };

export function readPageRequest(input: { page?: string; size?: string }): PageRequest {
  const page = clamp(wholeNumber(input.page, 1), 1, MAX_PAGE);
  const pageSize = clamp(wholeNumber(input.size, DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE);

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export type PageInfo = PageRequest & {
  totalCount: number;
  pageCount: number;
  /** 1-based positions of the rows on this page, for "26 to 50 of 1,000". */
  firstRow: number;
  lastRow: number;
  previousPage: number | null;
  nextPage: number | null;
};

export function pageInfo(request: PageRequest, totalCount: number): PageInfo {
  const pageCount = Math.max(Math.ceil(totalCount / request.pageSize), 1);
  const firstRow = totalCount === 0 ? 0 : request.skip + 1;

  return {
    ...request,
    totalCount,
    pageCount,
    firstRow,
    lastRow: Math.min(request.skip + request.pageSize, totalCount),
    previousPage: request.page > 1 ? request.page - 1 : null,
    nextPage: request.page < pageCount ? request.page + 1 : null,
  };
}

/**
 * Keeps the current search and filters when only the page number changes.
 *
 * The query string is its own function because a form that has to post the list
 * it came from needs the same string without a path in front of it.
 */
export function pageQueryString(query: Record<string, string>, page: number): string {
  const search = new URLSearchParams(query);
  if (page <= 1) search.delete('page');
  else search.set('page', String(page));

  return search.toString();
}

export function pageHref(basePath: string, query: Record<string, string>, page: number): string {
  const encoded = pageQueryString(query, page);
  return encoded ? `${basePath}?${encoded}` : basePath;
}

function wholeNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  return Number(raw.trim());
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
