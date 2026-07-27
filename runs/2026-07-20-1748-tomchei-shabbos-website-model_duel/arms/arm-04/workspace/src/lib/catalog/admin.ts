import 'server-only';

import type { AddOn, Product } from '@prisma/client';
import { z } from 'zod';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { db } from '../db';
import { dollarsFromForm } from '../core/money';
import { isMissingRecord, isUniqueViolation } from '../core/prisma';
import { failure, ok, type Result } from '../core/result';

export const DUPLICATE_SLUG = 'duplicate_slug';
export const INVALID_CATALOG_INPUT = 'invalid_catalog_input';
export const INVALID_REPLACEMENT = 'invalid_replacement';

const MISSING_PRODUCT = 'That product no longer exists.';
const MISSING_ADD_ON = 'That add-on no longer exists.';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'The web address may only use lowercase letters, numbers and dashes.')
  .max(80);

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value));

/** Blank means "not measured yet". Zero is a measurement, and no package is 0 mm wide. */
const wholeNumber = (unit: 'millimetres' | 'grams') =>
  z
    .string()
    .trim()
    .regex(/^\d*$/, `Enter a whole number of ${unit}, or leave it blank.`)
    .transform((value) => (value === '' ? null : Number(value)))
    .refine((value) => value === null || value > 0, 'Sizes and weights have to be more than zero.');

const productSchema = z.object({
  seasonId: z.string().min(1),
  slug: slugSchema,
  name: z.string().trim().min(1, 'Give the product a name.').max(120),
  description: optionalText,
  category: optionalText,
  kind: z.enum(['PACKAGE', 'BUNDLE', 'SPONSORSHIP']),
  price: dollarsFromForm,
  lengthMm: wholeNumber('millimetres'),
  widthMm: wholeNumber('millimetres'),
  heightMm: wholeNumber('millimetres'),
  weightGrams: wholeNumber('grams'),
  imageAssetId: optionalText,
  tracksInventory: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});

/** `kind` arrives as whatever the form posted; the schema is what narrows it. */
export type ProductInput = Omit<z.input<typeof productSchema>, 'kind'> & {
  kind: string;
  productId?: string;
};

export async function saveProduct(
  context: StaffContext,
  input: ProductInput,
): Promise<Result<Product>> {
  const existing = input.productId
    ? await db.product.findUnique({ where: { id: input.productId } })
    : null;
  if (input.productId && !existing) return failure(INVALID_CATALOG_INPUT, MISSING_PRODUCT);

  // A product stays in the season it was created in. Moving it would strand the
  // options and stock rows that hang off it, and can collide with a slug that is
  // already taken in the season it lands in.
  const parsed = productSchema.safeParse(
    existing ? { ...input, seasonId: existing.seasonId } : input,
  );
  if (!parsed.success) return failure(INVALID_CATALOG_INPUT, parsed.error.issues[0].message);

  const season = await db.season.findUnique({ where: { id: parsed.data.seasonId } });
  if (!season) return failure(INVALID_CATALOG_INPUT, 'Pick the season this product belongs to.');

  // The photo id comes from a form, so it is checked here rather than left to
  // the foreign key, which would surface as a 500 instead of a message.
  if (parsed.data.imageAssetId) {
    const photos = await db.mediaAsset.count({ where: { id: parsed.data.imageAssetId } });
    if (photos === 0) {
      return failure(INVALID_CATALOG_INPUT, 'That photo is not in the media library any more.');
    }
  }

  const { price, ...fields } = parsed.data;
  const data = { ...fields, priceCents: price };

  try {
    const product = existing
      ? await db.product.update({ where: { id: existing.id }, data })
      : await db.product.create({ data });

    await recordAudit(context, {
      action: 'catalog.product_saved',
      entityType: 'Product',
      entityId: product.id,
      detail: { slug: product.slug, seasonYear: season.year, created: !existing },
    });

    return ok(product);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return failure(DUPLICATE_SLUG, `${season.label} already has a product at "${parsed.data.slug}".`);
    }
    if (isMissingRecord(error)) return failure(INVALID_CATALOG_INPUT, MISSING_PRODUCT);
    throw error;
  }
}

/**
 * Points a retired product at the one that took its place (R-148, R-048).
 *
 * The link only ever points forward in time: a link into the same season or
 * backwards would make the chain walk in circles. Several retired products may
 * share one replacement — trimming a catalogue folds boxes together, and that
 * has to be sayable.
 */
export async function setReplacementLink(
  context: StaffContext,
  input: { productId: string; replacedByProductId: string | null },
): Promise<Result<Product>> {
  const product = await db.product.findUnique({
    where: { id: input.productId },
    include: { season: true },
  });
  if (!product) return failure(INVALID_REPLACEMENT, MISSING_PRODUCT);

  if (input.replacedByProductId) {
    const replacement = await db.product.findUnique({
      where: { id: input.replacedByProductId },
      include: { season: true },
    });

    if (!replacement) return failure(INVALID_REPLACEMENT, 'That replacement no longer exists.');
    if (replacement.season.year <= product.season.year) {
      return failure(
        INVALID_REPLACEMENT,
        `A replacement has to come from a later season than ${product.season.label}.`,
      );
    }
  }

  const updated = await db.product.update({
    where: { id: product.id },
    data: { replacedByProductId: input.replacedByProductId },
  });

  await recordAudit(context, {
    action: 'catalog.replacement_linked',
    entityType: 'Product',
    entityId: updated.id,
    detail: { slug: updated.slug, replacedByProductId: input.replacedByProductId },
  });

  return ok(updated);
}

const addOnSchema = z.object({
  seasonId: z.string().min(1),
  slug: slugSchema,
  name: z.string().trim().min(1, 'Give the add-on a name.').max(120),
  price: dollarsFromForm,
  tracksInventory: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});

export type AddOnInput = z.input<typeof addOnSchema> & {
  addOnId?: string;
  restrictedToProductIds: string[];
};

/**
 * An add-on with no restrictions is offered on every product; naming products
 * narrows it to exactly those, which is how "extra bottle of wine" stays tied
 * to the wine basket (R-066).
 */
export async function saveAddOn(context: StaffContext, input: AddOnInput): Promise<Result<AddOn>> {
  const parsed = addOnSchema.safeParse(input);
  if (!parsed.success) return failure(INVALID_CATALOG_INPUT, parsed.error.issues[0].message);

  const season = await db.season.findUnique({ where: { id: parsed.data.seasonId } });
  if (!season) return failure(INVALID_CATALOG_INPUT, 'Pick the season this add-on belongs to.');

  // The product ids come from a form, so they are checked against the add-on's
  // own season here: a restriction pointing at another season's product would
  // offer the add-on outside the season that owns it, and the cart builder
  // reads these rows as season-scoped.
  const restrictedToProductIds = [...new Set(input.restrictedToProductIds)];
  if (restrictedToProductIds.length > 0) {
    const inSeason = await db.product.count({
      where: { id: { in: restrictedToProductIds }, seasonId: parsed.data.seasonId },
    });
    if (inSeason !== restrictedToProductIds.length) {
      return failure(
        INVALID_CATALOG_INPUT,
        `An add-on can only be restricted to products in ${season.label}.`,
      );
    }
  }

  const { price, ...fields } = parsed.data;
  const data = { ...fields, priceCents: price };

  try {
    const addOn = await db.$transaction(async (tx) => {
      const saved = input.addOnId
        ? await tx.addOn.update({ where: { id: input.addOnId }, data })
        : await tx.addOn.create({ data });

      await tx.addOnProductRestriction.deleteMany({ where: { addOnId: saved.id } });
      if (restrictedToProductIds.length > 0) {
        await tx.addOnProductRestriction.createMany({
          data: restrictedToProductIds.map((productId) => ({ addOnId: saved.id, productId })),
        });
      }

      return saved;
    });

    await recordAudit(context, {
      action: 'catalog.addon_saved',
      entityType: 'AddOn',
      entityId: addOn.id,
      detail: { slug: addOn.slug, seasonYear: season.year, created: !input.addOnId },
    });

    return ok(addOn);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return failure(DUPLICATE_SLUG, `${season.label} already has an add-on at "${parsed.data.slug}".`);
    }
    if (isMissingRecord(error)) return failure(INVALID_CATALOG_INPUT, MISSING_ADD_ON);
    throw error;
  }
}