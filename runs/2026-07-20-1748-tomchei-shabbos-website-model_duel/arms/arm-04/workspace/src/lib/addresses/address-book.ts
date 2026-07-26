import 'server-only';

import { Prisma, type CustomerAddress } from '@prisma/client';
import { z } from 'zod';

import { recordAudit, type AuditActor } from '../audit';
import { normalizeAddressKey } from '../core/normalize';
import { normalizePhone } from '../core/phone';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { normalizePostalCode } from '../delivery-area';
import { readGeocodeCache } from '../geocode-cache';

export const ADDRESS_NOT_FOUND = 'address_not_found';
export const INVALID_ADDRESS = 'invalid_address';
export const DUPLICATE_ADDRESS = 'duplicate_address';

/** Volunteers drive and the shipper ships inside one country for now (G-014). */
export const DEFAULT_COUNTRY = 'US';

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value));

/**
 * Server-side validation for everything that reaches the address book (R-025).
 * The builder, the account page and the staff screen all post the same shape, so
 * the rules cannot differ between them.
 */
export const addressSchema = z.object({
  label: optionalText.pipe(z.string().max(60).nullable()),
  recipientName: z.string().trim().min(1, 'Who is this going to?').max(120),
  line1: z.string().trim().min(1, 'Enter the street address.').max(160),
  line2: optionalText.pipe(z.string().max(160).nullable()),
  city: z.string().trim().min(1, 'Enter the city.').max(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use the two-letter state code, for example NJ.'),
  postalCode: z
    .string()
    .trim()
    .transform((value) => normalizePostalCode(value))
    .refine((value): value is string => value !== null, {
      message: 'Enter a five-digit ZIP code, for example 08701.',
    }),
  phone: optionalText.refine((value) => value === null || normalizePhone(value) !== null, {
    message: 'Enter a 10-digit phone number, or leave it blank.',
  }),
});

export type AddressInput = z.input<typeof addressSchema>;

export type SavedAddress = Result<{ address: CustomerAddress; created: boolean }>;

/**
 * Writes one address into one customer's book (UR-014).
 *
 * Two addresses that normalize to the same key are the same place, so a second
 * "12 Main St." lands on the row that is already there instead of splitting the
 * recipient in two. Editing a saved address also rewrites the draft lines that
 * quote it: a draft is not a receipt, and a customer who fixes a street number
 * mid-order means the box that has not shipped yet, not just the next one.
 * Placed orders keep their snapshot — that is what P5 and the packing floor read.
 */
export async function saveCustomerAddress(
  input: AddressInput & { customerId: string; addressId?: string | null },
  actor: AuditActor = null,
): Promise<SavedAddress> {
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) return failure(INVALID_ADDRESS, parsed.error.issues[0].message);

  const existing = input.addressId
    ? await db.customerAddress.findFirst({
        where: { id: input.addressId, customerId: input.customerId },
      })
    : null;

  // A row that exists but belongs to somebody else answers exactly like a row
  // that never existed, so the id cannot be used to probe other people's books.
  if (input.addressId && !existing) return failure(ADDRESS_NOT_FOUND, MISSING_ADDRESS);

  const addressKey = normalizeAddressKey(parsed.data);
  const geocode = await geocodeColumns(addressKey);
  const fields = {
    ...parsed.data,
    // Stored in the dialling form, like the customer's own number: a driver
    // reading a manifest should not have to guess at "555.010.0100".
    phone: parsed.data.phone === null ? null : normalizePhone(parsed.data.phone),
    addressKey,
    isArchived: false,
    ...geocode,
  };

  try {
    const { address, created } = await db.$transaction(async (tx) => {
      const duplicate = await tx.customerAddress.findUnique({
        where: { customerId_addressKey: { customerId: input.customerId, addressKey } },
      });

      if (duplicate && duplicate.id !== existing?.id) {
        // Adding an address the book already holds is not an error: the caller
        // gets the row that is already there, with whatever new label or phone
        // came with this attempt.
        if (existing) throw new DuplicateAddress(duplicate);
        return {
          address: await tx.customerAddress.update({ where: { id: duplicate.id }, data: fields }),
          created: false,
        };
      }

      const saved = existing
        ? await tx.customerAddress.update({ where: { id: existing.id }, data: fields })
        : await tx.customerAddress.create({ data: { ...fields, customerId: input.customerId } });

      if (existing) await refreshDraftLines(tx, saved);

      return { address: saved, created: existing === null && duplicate === null };
    });

    await recordAudit(actor, {
      action: 'customer.address_saved',
      entityType: 'CustomerAddress',
      entityId: address.id,
      detail: { customerId: input.customerId, created },
    });

    return ok({ address, created });
  } catch (error) {
    if (error instanceof DuplicateAddress) {
      return failure(
        DUPLICATE_ADDRESS,
        `That is already saved as "${error.address.recipientName}". Edit that entry instead.`,
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return failure(ADDRESS_NOT_FOUND, MISSING_ADDRESS);
    }
    throw error;
  }
}

/** Archived, never deleted: placed orders and past seasons point at these rows. */
export async function archiveCustomerAddress(
  input: { customerId: string; addressId: string },
  actor: AuditActor = null,
): Promise<Result<CustomerAddress>> {
  const address = await db.customerAddress.findFirst({
    where: { id: input.addressId, customerId: input.customerId },
  });
  if (!address) return failure(ADDRESS_NOT_FOUND, MISSING_ADDRESS);

  const inUse = await db.orderLine.count({
    where: { customerAddressId: address.id, order: { status: 'DRAFT' } },
  });
  if (inUse > 0) {
    return failure(
      INVALID_ADDRESS,
      'That address is on an order you are still building. Reassign those items first.',
    );
  }

  const archived = await db.customerAddress.update({
    where: { id: address.id },
    data: { isArchived: true },
  });

  await recordAudit(actor, {
    action: 'customer.address_archived',
    entityType: 'CustomerAddress',
    entityId: archived.id,
    detail: { customerId: input.customerId },
  });

  return ok(archived);
}

export function listCustomerAddresses(customerId: string): Promise<CustomerAddress[]> {
  return db.customerAddress.findMany({
    where: { customerId, isArchived: false },
    orderBy: [{ recipientName: 'asc' }],
  });
}

export function findCustomerAddress(
  customerId: string,
  addressId: string,
): Promise<CustomerAddress | null> {
  return db.customerAddress.findFirst({ where: { id: addressId, customerId, isArchived: false } });
}

const MISSING_ADDRESS = 'That address is not in your address book.';

class DuplicateAddress extends Error {
  constructor(readonly address: CustomerAddress) {
    super('duplicate address key');
  }
}

/**
 * Coordinates come out of the geocode cache and nowhere else. There is no
 * geocoding provider wired up yet — route planning (P9) is what needs one — so
 * an address nobody has looked up keeps null coordinates rather than pretending
 * to have been located.
 */
async function geocodeColumns(addressKey: string) {
  const cached = await readGeocodeCache(addressKey);

  if (!cached || cached.outcome !== 'FOUND') {
    return { latitude: null, longitude: null, geocodedAt: null };
  }

  return { latitude: cached.latitude, longitude: cached.longitude, geocodedAt: cached.createdAt };
}

/** Drafts follow the saved address; placed orders keep the snapshot they shipped on. */
async function refreshDraftLines(
  tx: Prisma.TransactionClient,
  address: CustomerAddress,
): Promise<void> {
  await tx.orderLine.updateMany({
    where: { customerAddressId: address.id, order: { status: 'DRAFT' } },
    data: {
      recipientName: address.recipientName,
      addressLine1: address.line1,
      addressLine2: address.line2,
      addressCity: address.city,
      addressState: address.state,
      addressPostalCode: address.postalCode,
      addressCountry: address.country,
    },
  });
}
