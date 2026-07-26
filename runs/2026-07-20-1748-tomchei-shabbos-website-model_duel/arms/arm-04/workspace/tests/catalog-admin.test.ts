import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import type { StaffContext } from '../src/lib/auth/staff';
import {
  INVALID_CATALOG_INPUT,
  INVALID_REPLACEMENT,
  saveAddOn,
  saveProduct,
  setReplacementLink,
  type ProductInput,
} from '../src/lib/catalog/admin';
import { createProduct, createSeason, db } from './fixtures';

/**
 * The catalog admin is reached through forms, so every id in these tests is one
 * a browser could post: the point is what the server does when the form does not
 * say what the page offered.
 */

after(() => db.$disconnect());

let sequence = 0;

function nextKey(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence}`;
}

async function catalogManager(): Promise<StaffContext> {
  const staff = await db.staffUser.create({
    data: {
      email: `catalog-admin-${nextKey()}@tomchei.example`,
      fullName: 'Catalog Fixture',
      role: 'MANAGER',
      status: 'ACTIVE',
    },
    include: { permissionOverrides: true },
  });

  return { actor: staff, acting: staff, isImpersonating: false, permissions: ['catalog.manage'] };
}

function productInput(seasonId: string, overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    seasonId,
    slug: `fixture-${nextKey()}`,
    name: 'Fixture box',
    description: '',
    category: '',
    kind: 'PACKAGE',
    price: '36.00',
    lengthMm: '',
    widthMm: '',
    heightMm: '',
    weightGrams: '',
    imageAssetId: '',
    tracksInventory: false,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

test('a replacement has to come from a later season', async () => {
  const context = await catalogManager();
  const retiring = await createSeason();
  const later = await createSeason();

  const product = await createProduct(retiring, { onHand: null });
  const sibling = await createProduct(retiring, { onHand: null });
  const successor = await createProduct(later, { onHand: null });

  const backwards = await setReplacementLink(context, {
    productId: successor.id,
    replacedByProductId: product.id,
  });
  assert.equal(backwards.ok, false);
  assert.equal(backwards.ok === false && backwards.code, INVALID_REPLACEMENT);

  const withinSeason = await setReplacementLink(context, {
    productId: product.id,
    replacedByProductId: sibling.id,
  });
  assert.equal(withinSeason.ok, false);

  const forwards = await setReplacementLink(context, {
    productId: product.id,
    replacedByProductId: successor.id,
  });
  assert.equal(forwards.ok && forwards.value.replacedByProductId, successor.id);

  // Clearing the link is always allowed: it points at nothing.
  const cleared = await setReplacementLink(context, {
    productId: product.id,
    replacedByProductId: null,
  });
  assert.equal(cleared.ok && cleared.value.replacedByProductId, null);
});

test('an add-on can only be restricted to products in its own season', async () => {
  const context = await catalogManager();
  const season = await createSeason();
  const otherSeason = await createSeason();

  const ownProduct = await createProduct(season, { onHand: null });
  const foreignProduct = await createProduct(otherSeason, { onHand: null });

  const rejected = await saveAddOn(context, {
    seasonId: season.id,
    slug: `wine-${nextKey()}`,
    name: 'Extra bottle',
    price: '18.00',
    tracksInventory: false,
    isActive: true,
    sortOrder: 0,
    restrictedToProductIds: [ownProduct.id, foreignProduct.id],
  });

  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok === false && rejected.code, INVALID_CATALOG_INPUT);
  assert.equal(await db.addOnProductRestriction.count({ where: { productId: foreignProduct.id } }), 0);

  const accepted = await saveAddOn(context, {
    seasonId: season.id,
    slug: `wine-${nextKey()}`,
    name: 'Extra bottle',
    price: '18.00',
    tracksInventory: false,
    isActive: true,
    sortOrder: 0,
    restrictedToProductIds: [ownProduct.id],
  });

  assert.equal(accepted.ok, true);
  assert.equal(await db.addOnProductRestriction.count({ where: { productId: ownProduct.id } }), 1);
});

test('a saved product keeps the season it was created in', async () => {
  const context = await catalogManager();
  const season = await createSeason();
  const otherSeason = await createSeason();

  const created = await saveProduct(context, productInput(season.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const moved = await saveProduct(context, {
    ...productInput(otherSeason.id, { slug: created.value.slug }),
    productId: created.value.id,
  });

  assert.equal(moved.ok && moved.value.seasonId, season.id);
});

test('form-supplied ids that name nothing come back as a message, not a crash', async () => {
  const context = await catalogManager();
  const season = await createSeason();
  const missingId = '11111111-1111-4111-8111-111111111111';

  const unknownPhoto = await saveProduct(
    context,
    productInput(season.id, { imageAssetId: missingId }),
  );
  assert.equal(unknownPhoto.ok, false);
  assert.equal(unknownPhoto.ok === false && unknownPhoto.code, INVALID_CATALOG_INPUT);

  const unknownProduct = await saveProduct(context, {
    ...productInput(season.id),
    productId: missingId,
  });
  assert.equal(unknownProduct.ok, false);

  const unknownRestriction = await saveAddOn(context, {
    seasonId: season.id,
    slug: `addon-${nextKey()}`,
    name: 'Extra bottle',
    price: '18.00',
    tracksInventory: false,
    isActive: true,
    sortOrder: 0,
    restrictedToProductIds: [missingId],
  });
  assert.equal(unknownRestriction.ok, false);
});

test('a size of zero is not a size', async () => {
  const context = await catalogManager();
  const season = await createSeason();

  const zeroWidth = await saveProduct(context, productInput(season.id, { widthMm: '0' }));
  assert.equal(zeroWidth.ok, false);

  const measured = await saveProduct(context, productInput(season.id, { widthMm: '240' }));
  assert.equal(measured.ok && measured.value.widthMm, 240);
});
