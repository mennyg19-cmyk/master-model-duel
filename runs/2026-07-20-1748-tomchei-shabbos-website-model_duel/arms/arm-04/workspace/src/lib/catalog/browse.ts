/**
 * How the storefront grid narrows and orders itself. Kept free of Prisma and of
 * `server-only` so the rules can be unit-tested directly: the season's catalog is
 * a few dozen rows, so filtering and sorting in memory beats a new query per
 * control combination.
 */

export type CatalogOption = {
  groupLabel: string;
  label: string;
  priceAdjustmentCents: number;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  priceCents: number;
  isSoldOut: boolean;
  sortOrder: number;
  imageUrl: string | null;
  imageAltText: string | null;
  options: CatalogOption[];
};

export const CATALOG_SORTS = {
  featured: 'Featured',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
} as const;

export type CatalogSort = keyof typeof CATALOG_SORTS;

export const DEFAULT_SORT: CatalogSort = 'featured';

export function isCatalogSort(value: string | undefined): value is CatalogSort {
  return value !== undefined && value in CATALOG_SORTS;
}

/**
 * The URL of one state of the grid. The category chips and the quick-view close
 * link both build it, and they have to agree — including leaving `sort` off when
 * it is the default, so the plain grid has one address and not two.
 */
export function catalogHref(
  basePath: string,
  { category, sort }: { category?: string | null; sort?: CatalogSort },
): string {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (sort && sort !== DEFAULT_SORT) params.set('sort', sort);

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function categoriesOf(products: CatalogProduct[]): string[] {
  const categories = new Set<string>();
  for (const product of products) {
    if (product.category) categories.add(product.category);
  }
  return [...categories].sort();
}

/**
 * Sold-out items stay in the grid rather than disappearing: people search for
 * last year's box by name, and "sold out" answers that question while a missing
 * card does not (R-016). They sink below what can still be bought.
 */
export function browseCatalog(
  products: CatalogProduct[],
  { category, sort }: { category?: string; sort?: CatalogSort },
): CatalogProduct[] {
  const filtered = category ? products.filter((product) => product.category === category) : products;
  const comparator = COMPARATORS[sort ?? DEFAULT_SORT];

  return [...filtered].sort(
    (left, right) =>
      Number(left.isSoldOut) - Number(right.isSoldOut) ||
      comparator(left, right) ||
      left.name.localeCompare(right.name),
  );
}

const COMPARATORS: Record<CatalogSort, (left: CatalogProduct, right: CatalogProduct) => number> = {
  featured: (left, right) => left.sortOrder - right.sortOrder,
  'price-asc': (left, right) => lowestPriceCents(left) - lowestPriceCents(right),
  'price-desc': (left, right) => lowestPriceCents(right) - lowestPriceCents(left),
};

/**
 * Options adjust the price, so a box is sorted by the cheapest way to buy it —
 * the number the card shows. Sorting by the base price would put a $36 box that
 * only exists in a $48 size above a flat $40 one.
 */
export function lowestPriceCents(product: CatalogProduct): number {
  const adjustments = product.options.map((option) => option.priceAdjustmentCents);
  return product.priceCents + (adjustments.length > 0 ? Math.min(...adjustments) : 0);
}

export function highestPriceCents(product: CatalogProduct): number {
  const adjustments = product.options.map((option) => option.priceAdjustmentCents);
  return product.priceCents + (adjustments.length > 0 ? Math.max(...adjustments) : 0);
}

/** Options grouped for the detail page, in the order the admin set them. */
export function optionGroups(product: CatalogProduct): { label: string; options: CatalogOption[] }[] {
  const groups = new Map<string, CatalogOption[]>();

  for (const option of product.options) {
    const existing = groups.get(option.groupLabel);
    if (existing) existing.push(option);
    else groups.set(option.groupLabel, [option]);
  }

  return [...groups].map(([label, options]) => ({ label, options }));
}
