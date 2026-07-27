import 'server-only';

import { Prisma, type Season } from '@prisma/client';
import { z } from 'zod';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';

/**
 * Starting next Purim (R-097).
 *
 * A season is a fresh set of catalogue rows, not a flag on last year's, which is
 * what makes the archive browsable and what keeps last year's prices on last
 * year's orders. That is also what makes a new season tedious to type, so the
 * wizard copies the catalogue the office picks and leaves the shelves empty:
 * every copied product starts at zero on hand, because nothing has been bought
 * yet and a season that opened with last year's stock counts would oversell on
 * the first evening.
 *
 * A new season is always created closed. Opening it is a separate, audited
 * decision (UR-008).
 */
export const INVALID_SEASON = 'invalid_season';
export const DUPLICATE_SEASON = 'duplicate_season';

const seasonSchema = z.object({
  year: z.coerce
    .number()
    .int()
    .min(2000, 'Use a four-digit year.')
    .max(2100, 'Use a four-digit year.'),
  label: z.string().trim().min(1, 'Give the season a name, for example "Purim 2027".').max(80),
  copyFromSeasonId: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value)),
  /** Empty means every product in the source season. */
  productIds: z.array(z.string()),
  copyAddOns: z.boolean(),
  linkReplacements: z.boolean(),
});

export type NewSeasonInput = z.input<typeof seasonSchema>;

export type NewSeason = {
  season: Season;
  productCount: number;
  addOnCount: number;
  replacementLinkCount: number;
};

export async function createSeasonFromWizard(
  staff: StaffContext,
  input: NewSeasonInput,
): Promise<Result<NewSeason>> {
  const parsed = seasonSchema.safeParse(input);
  if (!parsed.success) return failure(INVALID_SEASON, parsed.error.issues[0].message);

  const source = parsed.data.copyFromSeasonId
    ? await db.season.findUnique({
        where: { id: parsed.data.copyFromSeasonId },
        include: {
          products: { include: { options: true }, orderBy: { sortOrder: 'asc' } },
          addOns: { include: { restrictions: true }, orderBy: { sortOrder: 'asc' } },
        },
      })
    : null;

  if (parsed.data.copyFromSeasonId && !source) {
    return failure(INVALID_SEASON, 'The season you asked to copy from no longer exists.');
  }
  if (source && source.year >= parsed.data.year) {
    return failure(
      INVALID_SEASON,
      `${source.label} is not earlier than ${parsed.data.year}, so it cannot be the season this one follows.`,
    );
  }

  const wanted = new Set(parsed.data.productIds);
  const products = (source?.products ?? []).filter(
    (product) => wanted.size === 0 || wanted.has(product.id),
  );
  const addOns = parsed.data.copyAddOns ? (source?.addOns ?? []) : [];

  try {
    const created = await db.$transaction(async (tx) => {
      const season = await tx.season.create({
        data: { year: parsed.data.year, label: parsed.data.label, status: 'CLOSED' },
      });

      const twins = await copyProducts(tx, season.id, products);
      await copyAddOns(tx, season.id, addOns, twins);

      const replacementLinkCount = parsed.data.linkReplacements
        ? await drawReplacementLinks(tx, twins)
        : 0;

      return { season, productCount: twins.size, addOnCount: addOns.length, replacementLinkCount };
    });

    await recordAudit(staff, {
      action: 'season.created',
      entityType: 'Season',
      entityId: created.season.id,
      detail: {
        year: created.season.year,
        copiedFromYear: source?.year ?? null,
        productCount: created.productCount,
        addOnCount: created.addOnCount,
        replacementLinkCount: created.replacementLinkCount,
      },
    });

    return ok(created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return failure(DUPLICATE_SEASON, `There is already a season for ${parsed.data.year}.`);
    }
    throw error;
  }
}

type SourceSeason = Prisma.SeasonGetPayload<{
  include: {
    products: { include: { options: true } };
    addOns: { include: { restrictions: true } };
  };
}>;

/** Old product id -> new product id, so the add-on restrictions and the replacement links can both be rewritten against the new season. */
type Twins = Map<string, string>;

/**
 * Every copied product starts at zero on hand: nothing has been bought yet, and
 * a season that opened with last year's counts would oversell on the first
 * evening.
 */
async function copyProducts(
  tx: Prisma.TransactionClient,
  seasonId: string,
  products: SourceSeason['products'],
): Promise<Twins> {
  const twins: Twins = new Map();

  for (const product of products) {
    const copy = await tx.product.create({
      data: {
        seasonId,
        slug: product.slug,
        name: product.name,
        description: product.description,
        kind: product.kind,
        priceCents: product.priceCents,
        category: product.category,
        imageAssetId: product.imageAssetId,
        lengthMm: product.lengthMm,
        widthMm: product.widthMm,
        heightMm: product.heightMm,
        weightGrams: product.weightGrams,
        tracksInventory: product.tracksInventory,
        isActive: product.isActive,
        sortOrder: product.sortOrder,
        options: {
          create: product.options.map((option) => ({
            groupLabel: option.groupLabel,
            label: option.label,
            priceAdjustmentCents: option.priceAdjustmentCents,
            isDefault: option.isDefault,
            sortOrder: option.sortOrder,
          })),
        },
      },
    });

    if (copy.tracksInventory) {
      await tx.inventoryItem.create({ data: { productId: copy.id, onHand: 0 } });
    }

    twins.set(product.id, copy.id);
  }

  return twins;
}

async function copyAddOns(
  tx: Prisma.TransactionClient,
  seasonId: string,
  addOns: SourceSeason['addOns'],
  twins: Twins,
): Promise<void> {
  for (const addOn of addOns) {
    const copy = await tx.addOn.create({
      data: {
        seasonId,
        slug: addOn.slug,
        name: addOn.name,
        priceCents: addOn.priceCents,
        tracksInventory: addOn.tracksInventory,
        isActive: addOn.isActive,
        sortOrder: addOn.sortOrder,
      },
    });

    if (copy.tracksInventory) {
      await tx.inventoryItem.create({ data: { addOnId: copy.id, onHand: 0 } });
    }

    // A restriction naming a product that was not carried over is dropped
    // rather than pointed at last season's row, which would offer the add-on
    // against a product this season's storefront never shows.
    const restrictedTo = addOn.restrictions.flatMap((restriction) => {
      const twinId = twins.get(restriction.productId);
      return twinId === undefined ? [] : [{ addOnId: copy.id, productId: twinId }];
    });

    if (restrictedTo.length > 0) {
      await tx.addOnProductRestriction.createMany({ data: restrictedTo });
    }
  }
}

/**
 * The slug already carries a product forward, so this is belt and braces — but
 * an explicit link survives a rename, and it is what the mappings screen shows
 * when somebody asks where last year's box went (R-048).
 */
async function drawReplacementLinks(tx: Prisma.TransactionClient, twins: Twins): Promise<number> {
  for (const [sourceProductId, twinId] of twins) {
    await tx.product.update({
      where: { id: sourceProductId },
      data: { replacedByProductId: twinId },
    });
  }

  return twins.size;
}
