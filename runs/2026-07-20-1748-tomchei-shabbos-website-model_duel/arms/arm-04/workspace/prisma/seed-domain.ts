import type { CustomerAddress, FulfillmentMethod, Product, Season } from '@prisma/client';

import { db } from '../src/lib/db';
import { normalizeAddressKey } from '../src/lib/core/normalize';
import { seasonLabel, seasonYearFor } from '../src/lib/core/season';
import { createDraftReference } from '../src/lib/orders/draft-reference';
import { finalizeOrder } from '../src/lib/orders/order-service';

/**
 * A working season: catalog, stock, fulfillment methods, an address book, and
 * one placed order that exercises the real finalize path rather than writing
 * packages by hand. Re-running matches every row on its natural key.
 */
const PRODUCTS = [
  {
    slug: 'classic-mishloach-manos',
    name: 'Classic Mishloach Manos',
    description: 'Hamantaschen, nosh and a bottle of grape juice in a keepsake box.',
    category: 'Boxes',
    priceCents: 3600,
    lengthMm: 300,
    widthMm: 220,
    heightMm: 120,
    weightGrams: 1400,
    onHand: 250,
    options: [
      { groupLabel: 'Size', label: 'Standard', priceAdjustmentCents: 0, isDefault: true },
      { groupLabel: 'Size', label: 'Large', priceAdjustmentCents: 1200, isDefault: false },
    ],
  },
  {
    slug: 'deluxe-wine-basket',
    name: 'Deluxe Wine Basket',
    description: 'Kosher wine, dried fruit and chocolate in a lined basket.',
    category: 'Baskets',
    priceCents: 7200,
    lengthMm: 360,
    widthMm: 280,
    heightMm: 180,
    weightGrams: 3200,
    onHand: 100,
    options: [],
  },
] as const;

const SPONSORSHIP = {
  slug: 'sponsor-a-family',
  name: 'Sponsor a Family',
  description: 'Covers a full Shabbos package for a family in need.',
  category: 'Sponsorships',
  priceCents: 18000,
};

const ADD_ONS = [
  { slug: 'bottle-of-wine', name: 'Extra bottle of wine', priceCents: 1800, onHand: 60 },
  { slug: 'handwritten-card', name: 'Hand-written card', priceCents: 300, onHand: null },
];

const FULFILLMENT_METHODS = [
  { code: 'ship', label: 'Ship to recipient', kind: 'SHIPPING', baseFeeCents: 1200, requiresPickupLocation: false, requiresAddress: true },
  { code: 'deliver', label: 'Volunteer delivery', kind: 'DELIVERY', baseFeeCents: 500, requiresPickupLocation: false, requiresAddress: true },
  { code: 'pickup', label: 'Pick up at the office', kind: 'PICKUP', baseFeeCents: 0, requiresPickupLocation: true, requiresAddress: false },
] as const;

const PACKAGE_TYPES = [
  { name: 'Small box', lengthMm: 320, widthMm: 240, heightMm: 140, maxWeightGrams: 5000 },
  { name: 'Large box', lengthMm: 460, widthMm: 360, heightMm: 260, maxWeightGrams: 15000 },
];

const ADDRESSES = [
  {
    label: 'Miriam',
    recipientName: 'Miriam Klein',
    line1: '412 Forest Avenue',
    line2: 'Apt 3B',
    city: 'Lakewood',
    state: 'NJ',
    postalCode: '08701',
  },
  {
    label: 'Rabbi Stein',
    recipientName: 'Rabbi Stein',
    line1: '88 Yeshiva Lane',
    line2: null,
    city: 'Monsey',
    state: 'NY',
    postalCode: '10952',
  },
];

const GREETING = 'Freilichen Purim from the Donor family';

/**
 * Purim falls in Adar; the store opens six weeks before and closes the night
 * before packing starts. Months are zero-based, the way `Date.UTC` takes them.
 */
const SEASON_OPENS_ON = { month: 0, day: 5 };
const SEASON_CLOSES_ON = { month: 2, day: 1 };

export async function seedDomain(customerId: string): Promise<{ season: Season }> {
  const season = await upsertSeason(seasonYearFor(new Date()), 'OPEN');
  const previousSeason = await upsertSeason(season.year - 1, 'CLOSED');

  const methods = await upsertFulfillmentMethods();
  await upsertPackageTypesAndPickup();

  const products = await upsertCatalog(season);
  await linkReplacements(previousSeason, products);

  const addresses = await upsertAddresses(customerId);
  await placeDemoOrder(season, customerId, products, methods, addresses);

  return { season };
}

async function upsertSeason(year: number, status: 'OPEN' | 'CLOSED'): Promise<Season> {
  return db.season.upsert({
    where: { year },
    create: {
      year,
      label: seasonLabel(year),
      status,
      opensAt: new Date(Date.UTC(year, SEASON_OPENS_ON.month, SEASON_OPENS_ON.day)),
      closesAt: new Date(Date.UTC(year, SEASON_CLOSES_ON.month, SEASON_CLOSES_ON.day)),
    },
    update: { label: seasonLabel(year), status },
  });
}

async function upsertFulfillmentMethods(): Promise<Map<string, FulfillmentMethod>> {
  const rows = new Map<string, FulfillmentMethod>();

  for (const [index, method] of FULFILLMENT_METHODS.entries()) {
    const row = await db.fulfillmentMethod.upsert({
      where: { code: method.code },
      create: { ...method, sortOrder: index },
      update: { label: method.label, baseFeeCents: method.baseFeeCents, sortOrder: index },
    });
    rows.set(method.code, row);
  }

  return rows;
}

async function upsertPackageTypesAndPickup(): Promise<void> {
  for (const packageType of PACKAGE_TYPES) {
    await db.packageType.upsert({
      where: { name: packageType.name },
      create: packageType,
      update: packageType,
    });
  }

  await db.pickupLocation.upsert({
    where: { name: 'Main office' },
    create: {
      name: 'Main office',
      line1: '1 Clifton Avenue',
      city: 'Lakewood',
      state: 'NJ',
      postalCode: '08701',
      instructions: 'Ring the bell at the side door; packages are in the front room.',
    },
    update: {},
  });
}

async function upsertCatalog(season: Season): Promise<Map<string, Product>> {
  const products = new Map<string, Product>();

  for (const [index, definition] of PRODUCTS.entries()) {
    const { options, onHand, ...fields } = definition;

    const product = await db.product.upsert({
      where: { seasonId_slug: { seasonId: season.id, slug: definition.slug } },
      create: { ...fields, seasonId: season.id, sortOrder: index },
      update: {
        name: fields.name,
        priceCents: fields.priceCents,
        category: fields.category,
        sortOrder: index,
      },
    });

    for (const [optionIndex, option] of options.entries()) {
      await db.productOption.upsert({
        where: {
          productId_groupLabel_label: {
            productId: product.id,
            groupLabel: option.groupLabel,
            label: option.label,
          },
        },
        create: { ...option, productId: product.id, sortOrder: optionIndex },
        update: { priceAdjustmentCents: option.priceAdjustmentCents },
      });
    }

    await db.inventoryItem.upsert({
      where: { productId: product.id },
      create: { productId: product.id, onHand },
      update: {},
    });

    products.set(definition.slug, product);
  }

  const sponsorship = await db.product.upsert({
    where: { seasonId_slug: { seasonId: season.id, slug: SPONSORSHIP.slug } },
    create: {
      ...SPONSORSHIP,
      seasonId: season.id,
      kind: 'SPONSORSHIP',
      tracksInventory: false,
      sortOrder: PRODUCTS.length,
    },
    update: { priceCents: SPONSORSHIP.priceCents, category: SPONSORSHIP.category },
  });
  products.set(SPONSORSHIP.slug, sponsorship);

  await upsertAddOns(season, products);
  return products;
}

async function upsertAddOns(season: Season, products: Map<string, Product>): Promise<void> {
  for (const [index, definition] of ADD_ONS.entries()) {
    const { onHand, ...fields } = definition;

    const addOn = await db.addOn.upsert({
      where: { seasonId_slug: { seasonId: season.id, slug: definition.slug } },
      create: {
        ...fields,
        seasonId: season.id,
        sortOrder: index,
        tracksInventory: onHand !== null,
      },
      update: { name: fields.name, priceCents: fields.priceCents },
    });

    if (onHand !== null) {
      await db.inventoryItem.upsert({
        where: { addOnId: addOn.id },
        create: { addOnId: addOn.id, onHand },
        update: {},
      });
    }
  }

  // Wine only makes sense with the basket, so it is restricted to that product.
  const wine = await db.addOn.findUniqueOrThrow({
    where: { seasonId_slug: { seasonId: season.id, slug: 'bottle-of-wine' } },
  });
  const basket = products.get('deluxe-wine-basket');
  if (!basket) throw new Error('The wine add-on has no basket to attach to.');

  await db.addOnProductRestriction.upsert({
    where: { addOnId_productId: { addOnId: wine.id, productId: basket.id } },
    create: { addOnId: wine.id, productId: basket.id },
    update: {},
  });
}

/** Last year's box points at this year's replacement, which is what repeat-order walks (P10). */
async function linkReplacements(previousSeason: Season, products: Map<string, Product>): Promise<void> {
  const thisYearClassic = products.get('classic-mishloach-manos');
  if (!thisYearClassic) throw new Error('This season has no classic box to replace last year with.');

  const lastYearClassic = await db.product.upsert({
    where: { seasonId_slug: { seasonId: previousSeason.id, slug: 'classic-mishloach-manos' } },
    create: {
      seasonId: previousSeason.id,
      slug: 'classic-mishloach-manos',
      name: 'Classic Mishloach Manos',
      priceCents: 3400,
      tracksInventory: false,
      isActive: false,
    },
    update: {},
  });

  if (lastYearClassic.replacedByProductId === thisYearClassic.id) return;

  await db.product.update({
    where: { id: lastYearClassic.id },
    data: { replacedByProductId: thisYearClassic.id },
  });
}

async function upsertAddresses(customerId: string): Promise<CustomerAddress[]> {
  const rows: CustomerAddress[] = [];

  for (const address of ADDRESSES) {
    const addressKey = normalizeAddressKey(address);

    rows.push(
      await db.customerAddress.upsert({
        where: { customerId_addressKey: { customerId, addressKey } },
        create: { ...address, customerId, addressKey },
        update: { recipientName: address.recipientName },
      }),
    );
  }

  return rows;
}

/**
 * Two recipients and three lines, so the seeded data shows the grouping engine
 * doing its job: the two boxes going to Miriam with one greeting merge into a
 * single package, and Rabbi Stein's box is its own.
 */
async function placeDemoOrder(
  season: Season,
  customerId: string,
  products: Map<string, Product>,
  methods: Map<string, FulfillmentMethod>,
  addresses: CustomerAddress[],
): Promise<void> {
  const existing = await db.order.findFirst({ where: { customerId, seasonId: season.id } });
  if (existing) {
    console.log(`Demo order already exists (${existing.draftReference})`);
    return;
  }

  const classic = products.get('classic-mishloach-manos');
  const basket = products.get('deluxe-wine-basket');
  const deliver = methods.get('deliver');
  const ship = methods.get('ship');
  const [miriam, rabbi] = addresses;

  if (!classic || !basket || !deliver || !ship || !miriam || !rabbi) {
    throw new Error('The demo order is missing catalog, fulfillment or address rows.');
  }

  const wine = await db.addOn.findUniqueOrThrow({
    where: { seasonId_slug: { seasonId: season.id, slug: 'bottle-of-wine' } },
  });

  const order = await db.order.create({
    data: {
      seasonId: season.id,
      customerId,
      draftReference: createDraftReference(),
      defaultGreeting: GREETING,
      lines: {
        create: [
          orderLine(classic, 2, deliver.id, miriam, GREETING),
          {
            ...orderLine(basket, 1, deliver.id, miriam, GREETING),
            addOns: {
              create: [
                {
                  addOnId: wine.id,
                  quantity: 1,
                  addOnNameSnapshot: wine.name,
                  unitPriceCents: wine.priceCents,
                  lineTotalCents: wine.priceCents,
                },
              ],
            },
          },
          orderLine(classic, 1, ship.id, rabbi, 'With gratitude for everything you do'),
        ],
      },
    },
  });

  // Seeding is not a signed-in person, so the audit rows are logged as system.
  const finalized = await finalizeOrder(order.id, null);
  if (!finalized.ok) throw new Error(`The demo order could not be placed: ${finalized.publicMessage}`);

  console.log(
    `Placed demo order #${finalized.value.orderNumber} with ${finalized.value.packageCount} packages`,
  );
}

function orderLine(
  product: Product,
  quantity: number,
  fulfillmentMethodId: string,
  address: CustomerAddress,
  greetingMessage: string,
) {
  return {
    productId: product.id,
    quantity,
    productNameSnapshot: product.name,
    unitPriceCents: product.priceCents,
    lineTotalCents: product.priceCents * quantity,
    recipientName: address.recipientName,
    fulfillmentMethodId,
    customerAddressId: address.id,
    addressLine1: address.line1,
    addressLine2: address.line2,
    addressCity: address.city,
    addressState: address.state,
    addressPostalCode: address.postalCode,
    addressCountry: address.country,
    greetingMessage,
  };
}
