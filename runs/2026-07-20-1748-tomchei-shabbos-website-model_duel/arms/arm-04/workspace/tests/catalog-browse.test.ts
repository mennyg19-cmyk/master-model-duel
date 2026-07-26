import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  browseCatalog,
  catalogHref,
  categoriesOf,
  highestPriceCents,
  isCatalogSort,
  lowestPriceCents,
  optionGroups,
  type CatalogProduct,
} from '../src/lib/catalog/browse';
import {
  checkDeliveryArea,
  normalizePostalCode,
  parseDeliveryZipList,
} from '../src/lib/delivery-area';

function product(overrides: Partial<CatalogProduct> & { slug: string }): CatalogProduct {
  return {
    id: overrides.slug,
    name: overrides.slug,
    description: null,
    category: null,
    priceCents: 1000,
    isSoldOut: false,
    sortOrder: 0,
    imageUrl: null,
    imageAltText: null,
    options: [],
    ...overrides,
  };
}

const CATALOG: CatalogProduct[] = [
  product({ slug: 'box', category: 'Boxes', priceCents: 3600, sortOrder: 0 }),
  product({ slug: 'basket', category: 'Baskets', priceCents: 7200, sortOrder: 1 }),
  product({ slug: 'sold-out-box', category: 'Boxes', priceCents: 1200, sortOrder: 2, isSoldOut: true }),
  product({
    slug: 'upgradeable',
    category: 'Boxes',
    priceCents: 4000,
    sortOrder: 3,
    options: [
      { groupLabel: 'Size', label: 'Standard', priceAdjustmentCents: 0 },
      { groupLabel: 'Size', label: 'Large', priceAdjustmentCents: 1500 },
    ],
  }),
];

test('sold-out products stay in the grid but sink below what can be bought', () => {
  const slugs = browseCatalog(CATALOG, { sort: 'featured' }).map((item) => item.slug);
  assert.deepEqual(slugs, ['box', 'basket', 'upgradeable', 'sold-out-box']);
});

test('category filtering keeps only that category', () => {
  const slugs = browseCatalog(CATALOG, { category: 'Boxes' }).map((item) => item.slug);
  assert.deepEqual(slugs, ['box', 'upgradeable', 'sold-out-box']);
});

test('price sorting uses the cheapest way to buy the product', () => {
  const ascending = browseCatalog(CATALOG, { sort: 'price-asc' }).map((item) => item.slug);
  assert.deepEqual(ascending, ['box', 'upgradeable', 'basket', 'sold-out-box']);

  const descending = browseCatalog(CATALOG, { sort: 'price-desc' }).map((item) => item.slug);
  assert.deepEqual(descending, ['basket', 'upgradeable', 'box', 'sold-out-box']);
});

test('an option range reports its low and high price', () => {
  const upgradeable = CATALOG[3];
  assert.equal(lowestPriceCents(upgradeable), 4000);
  assert.equal(highestPriceCents(upgradeable), 5500);
  assert.deepEqual(optionGroups(upgradeable).map((group) => group.label), ['Size']);
});

test('categories come back sorted and deduped, skipping uncategorized products', () => {
  assert.deepEqual(categoriesOf([...CATALOG, product({ slug: 'other' })]), ['Baskets', 'Boxes']);
});

test('an unknown sort in the query string is not accepted', () => {
  assert.equal(isCatalogSort('price-asc'), true);
  assert.equal(isCatalogSort('cheapest'), false);
  assert.equal(isCatalogSort(undefined), false);
});

test('the grid URL leaves out the default sort so one state has one address', () => {
  assert.equal(catalogHref('/collection', { category: null, sort: 'featured' }), '/collection');
  assert.equal(
    catalogHref('/collection', { category: 'Boxes', sort: 'price-asc' }),
    '/collection?category=Boxes&sort=price-asc',
  );
  assert.equal(catalogHref('/collection', { category: 'Boxes' }), '/collection?category=Boxes');
});

test('ZIP codes normalize to five digits or fail', () => {
  assert.equal(normalizePostalCode(' 08701 '), '08701');
  assert.equal(normalizePostalCode('08701-1234'), '08701');
  assert.equal(normalizePostalCode('8701'), null);
  assert.equal(normalizePostalCode('L4J 8C7'), null);
});

test('delivery is refused outside the configured area and when nothing is configured', () => {
  const zips = ['08701', '10952'];

  assert.deepEqual(checkDeliveryArea('08701-1234', zips), { deliverable: true, postalCode: '08701' });
  assert.deepEqual(checkDeliveryArea('11219', zips), { deliverable: false, reason: 'out_of_area' });
  assert.deepEqual(checkDeliveryArea('nope', zips), { deliverable: false, reason: 'malformed' });
  assert.deepEqual(checkDeliveryArea('08701', []), { deliverable: false, reason: 'not_configured' });
});

test('the delivery ZIP textarea dedupes, sorts and reports what it rejected', () => {
  const parsed = parseDeliveryZipList('10952, 08701\n08701-1234\nLakewood');
  assert.deepEqual(parsed.zips, ['08701', '10952']);
  assert.deepEqual(parsed.rejected, ['Lakewood']);
});
