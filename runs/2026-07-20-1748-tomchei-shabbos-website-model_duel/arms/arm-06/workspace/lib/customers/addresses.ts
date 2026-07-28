import { Address, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { normalizeWhitespace } from "@/lib/text";
import { geocodeAddress } from "@/lib/customers/geocode";

type Db = Prisma.TransactionClient | PrismaClient;

// Address book (UR-014/R-145): one book per customer. Every write is
// normalized, validated, deduped on the normalized content key, and geocoded
// through the provider seam. Staff edits ride the same functions with an
// actor so the route can audit them (G-019).
export const addressInputSchema = z.object({
  label: z.string().trim().max(60).nullish(),
  line1: z.string().trim().min(2, "Street address is required").max(120),
  line2: z.string().trim().max(120).nullish(),
  city: z.string().trim().min(1, "City is required").max(80),
  region: z.string().trim().min(1, "State is required").max(40),
  postalCode: z.string().trim().min(3, "ZIP is required").max(12),
  country: z.string().trim().min(2).max(2).default("US"),
});

export type AddressInput = z.infer<typeof addressInputSchema>;

// Normalized content key: two addresses that differ only in case/spacing are
// the same address. Drives dedupe and the geocode cache key.
export function addressDedupeKey(input: {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): string {
  return [input.line1, input.line2 ?? "", input.city, input.region, input.postalCode, input.country]
    .map((part) => normalizeWhitespace(part).toLowerCase())
    .join("|");
}

export function normalizeAddressInput(input: AddressInput) {
  return {
    label: input.label ? normalizeWhitespace(input.label) : null,
    line1: normalizeWhitespace(input.line1),
    line2: input.line2 ? normalizeWhitespace(input.line2) : null,
    city: normalizeWhitespace(input.city),
    region: normalizeWhitespace(input.region),
    postalCode: normalizeWhitespace(input.postalCode),
    country: input.country.toUpperCase(),
  };
}

async function findDuplicate(
  customerId: string,
  key: string,
  excludeId: string | undefined,
  db: Db,
): Promise<Address | null> {
  const addresses = await db.address.findMany({ where: { customerId } });
  return (
    addresses.find((address) => address.id !== excludeId && addressDedupeKey(address) === key) ?? null
  );
}

// Creates a book entry, or returns the existing row when the normalized
// address is already in the book (dedupe on create never duplicates). Pass a
// transaction client when the save is part of a larger write (draft save).
export async function saveAddress(
  customerId: string,
  rawInput: AddressInput,
  db: Db = prisma,
): Promise<{ address: Address; created: boolean; deduped: boolean }> {
  const input = normalizeAddressInput(rawInput);
  const key = addressDedupeKey(input);

  const duplicate = await findDuplicate(customerId, key, undefined, db);
  if (duplicate) return { address: duplicate, created: false, deduped: true };

  const point = await geocodeAddress(key);
  try {
    const address = await db.address.create({
      data: {
        customerId,
        ...input,
        lat: point.lat,
        lng: point.lng,
        geocodedAt: new Date(),
      },
    });
    return { address, created: true, deduped: false };
  } catch (error) {
    // @@unique([customerId, label]): surface as a domain error, not a 500.
    // Same P2002 pattern as dedupe.ts — Prisma message text is not a contract.
    if (input.label && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainRuleError(`An address labeled "${input.label}" already exists`);
    }
    throw error;
  }
}

// Customer path: ownership is the customerId match itself. Staff path: pass
// the owning customerId explicitly (route resolved it from the target row).
export async function updateAddress(
  customerId: string,
  addressId: string,
  rawInput: AddressInput,
  db: Db = prisma,
): Promise<Address> {
  const existing = await db.address.findUnique({ where: { id: addressId } });
  if (!existing || existing.customerId !== customerId) throw new NotFoundError("Address", addressId);

  const input = normalizeAddressInput(rawInput);
  const key = addressDedupeKey(input);
  const duplicate = await findDuplicate(customerId, key, addressId, db);
  if (duplicate) {
    throw new DomainRuleError(
      `This duplicates the saved address "${duplicate.label ?? duplicate.line1}"; edit that one instead`,
    );
  }

  const point = await geocodeAddress(key);
  return db.address.update({
    where: { id: addressId },
    data: { ...input, lat: point.lat, lng: point.lng, geocodedAt: new Date() },
  });
}

export async function deleteAddress(customerId: string, addressId: string): Promise<void> {
  const existing = await prisma.address.findUnique({ where: { id: addressId } });
  if (!existing || existing.customerId !== customerId) throw new NotFoundError("Address", addressId);
  // Packages RESTRICT deletion of referenced addresses; draft recipients
  // SetNull (their snapshot keeps the delivery details).
  await prisma.address.delete({ where: { id: addressId } });
}

export function addressSummary(address: Address): string {
  return [address.line1, address.line2, `${address.city}, ${address.region} ${address.postalCode}`]
    .filter(Boolean)
    .join(", ");
}
