import type {
  AddOn,
  Customer,
  FeeBasis,
  FulfillmentKind,
  FulfillmentMethod,
  Order,
  PickupLocation,
  Product,
  Season,
  SeasonStatus,
} from '@prisma/client';

import type { Permission } from '../src/lib/auth/permissions';
import type { StaffContext } from '../src/lib/auth/staff';
import { db } from '../src/lib/db';
import { createDraftReference } from '../src/lib/orders/draft-reference';

export { db };

/**
 * Fixtures for the domain tests. Every row gets a unique natural key so tests
 * can run repeatedly against the same test database without colliding.
 */
let sequence = 0;

function nextKey(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence.toString(36)}`;
}

/**
 * Wipes every table except Prisma's own migration history. Tests that need a
 * genuinely empty database used to list the tables by hand, which went stale
 * the moment the schema grew a foreign key.
 */
export async function emptyDatabase(): Promise<void> {
  // Names come from the catalog, not from anything a caller passes in.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;

  if (tables.length === 0) return;

  const targets = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${targets} CASCADE`);
}

let lastSeasonYear: number | null = null;

async function reserveSeasonYear(): Promise<number> {
  lastSeasonYear ??= (await db.season.aggregate({ _max: { year: true } }))._max.year ?? 3000;
  lastSeasonYear += 1;
  return lastSeasonYear;
}

export async function createSeason(status: SeasonStatus = 'OPEN'): Promise<Season> {
  const year = await reserveSeasonYear();
  return db.season.create({ data: { year, label: `Test season ${year}`, status } });
}

export async function createFulfillmentMethod(
  kind: FulfillmentKind = 'DELIVERY',
  baseFeeCents = 0,
  feeBasis: FeeBasis = 'PER_PACKAGE',
): Promise<FulfillmentMethod> {
  return db.fulfillmentMethod.create({
    data: {
      code: `method-${nextKey()}`,
      label: `Test ${kind.toLowerCase()}`,
      kind,
      baseFeeCents,
      feeBasis,
    },
  });
}

/** `onHand: null` means the product is not stock-tracked, like a sponsorship. */
export async function createProduct(
  season: Season,
  options: { priceCents?: number; onHand?: number | null } = {},
): Promise<Product> {
  const onHand = options.onHand === undefined ? 100 : options.onHand;
  const slug = `product-${nextKey()}`;

  const product = await db.product.create({
    data: {
      seasonId: season.id,
      slug,
      name: `Test ${slug}`,
      priceCents: options.priceCents ?? 1000,
      tracksInventory: onHand !== null,
    },
  });

  if (onHand !== null) await db.inventoryItem.create({ data: { productId: product.id, onHand } });
  return product;
}

export async function createCustomer(fullName = 'Test Customer'): Promise<Customer> {
  const email = `customer-${nextKey()}@example.test`;
  return db.customer.create({ data: { email, normalizedEmail: email, fullName } });
}

export async function createPickupLocation(): Promise<PickupLocation> {
  return db.pickupLocation.create({
    data: {
      name: `Pickup ${nextKey()}`,
      line1: '5 Depot Road',
      city: 'Lakewood',
      state: 'NJ',
      postalCode: '08701',
    },
  });
}

/** An add-on with no `restrictedToProductIds` is offered on every product (R-021). */
export async function createAddOn(
  season: Season,
  options: { priceCents?: number; onHand?: number | null; restrictedToProductIds?: string[] } = {},
): Promise<AddOn> {
  const onHand = options.onHand === undefined ? 100 : options.onHand;

  const addOn = await db.addOn.create({
    data: {
      seasonId: season.id,
      slug: `addon-${nextKey()}`,
      name: `Test add-on ${nextKey()}`,
      priceCents: options.priceCents ?? 500,
      tracksInventory: onHand !== null,
      restrictions: {
        create: (options.restrictedToProductIds ?? []).map((productId) => ({ productId })),
      },
    },
  });

  if (onHand !== null) await db.inventoryItem.create({ data: { addOnId: addOn.id, onHand } });
  return addOn;
}

export async function addProductOption(
  product: Product,
  option: { groupLabel: string; label: string; priceAdjustmentCents?: number },
): Promise<void> {
  await db.productOption.create({
    data: {
      productId: product.id,
      groupLabel: option.groupLabel,
      label: option.label,
      priceAdjustmentCents: option.priceAdjustmentCents ?? 0,
    },
  });
}

/**
 * A staff actor for audit assertions: the row an auditor comes looking for
 * (G-019). The permissions are narrow by default so a test has to say when it
 * is acting as somebody who may move money.
 */
export async function createStaffContext(
  permissions: Permission[] = ['customers.view', 'customers.manage'],
): Promise<StaffContext> {
  const staff = await db.staffUser.create({
    data: {
      email: `staff-${nextKey()}@tomchei.example`,
      fullName: 'Test Staff',
      role: 'MANAGER',
      status: 'ACTIVE',
    },
    include: { permissionOverrides: true },
  });

  return { actor: staff, acting: staff, isImpersonating: false, permissions };
}

export type DraftLineSpec = {
  product: Product;
  fulfillmentMethodId: string;
  quantity?: number;
  recipientName?: string;
  greetingMessage?: string | null;
  addressLine1?: string;
  /** Set when a test needs the line to point back at a saved address book row. */
  customerAddressId?: string;
};

export async function createDraftOrder(input: {
  season: Season;
  customer: Customer;
  lines: DraftLineSpec[];
}): Promise<Order> {
  return db.order.create({
    data: {
      seasonId: input.season.id,
      customerId: input.customer.id,
      draftReference: createDraftReference(),
      lines: { create: input.lines.map(toLineData) },
    },
  });
}

function toLineData(line: DraftLineSpec) {
  const quantity = line.quantity ?? 1;

  return {
    productId: line.product.id,
    quantity,
    productNameSnapshot: line.product.name,
    unitPriceCents: line.product.priceCents,
    lineTotalCents: line.product.priceCents * quantity,
    recipientName: line.recipientName ?? 'Test Recipient',
    fulfillmentMethodId: line.fulfillmentMethodId,
    customerAddressId: line.customerAddressId ?? null,
    addressLine1: line.addressLine1 ?? '1 Test Street',
    addressCity: 'Lakewood',
    addressState: 'NJ',
    addressPostalCode: '08701',
    addressCountry: 'US',
    greetingMessage: line.greetingMessage === undefined ? 'Test greeting' : line.greetingMessage,
  };
}
