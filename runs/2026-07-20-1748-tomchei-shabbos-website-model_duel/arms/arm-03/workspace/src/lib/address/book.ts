import { AuditAction, type Prisma, type SavedAddress } from "@prisma/client";
import { buildAddressNorm, validateAddressInput, type AddressParts } from "@/lib/address/normalize";
import { geocodeAddress } from "@/lib/address/geocode";
import { db } from "@/lib/db";
import { err, ok, type Result } from "@/lib/result";

export type AddressInput = AddressParts & {
  label?: string | null;
  phone?: string | null;
  isDefault?: boolean;
};

async function prepare(input: AddressInput) {
  const validationError = validateAddressInput(input);
  if (validationError) return { error: validationError as string };
  const geo = await geocodeAddress(input);
  const addressNorm = buildAddressNorm(input);
  return {
    data: {
      label: input.label?.trim() || null,
      recipientName: input.recipientName.trim(),
      line1: input.line1.trim(),
      line2: input.line2?.trim() || null,
      city: input.city.trim(),
      state: input.state.trim().toUpperCase(),
      postalCode: input.postalCode.trim(),
      country: (input.country ?? "US").trim().toUpperCase(),
      phone: input.phone?.trim() || null,
      addressNorm,
      latitude: geo.latitude,
      longitude: geo.longitude,
      geocodeStatus: geo.geocodeStatus,
      geocodedAt: geo.geocodedAt,
      isDefault: Boolean(input.isDefault),
    },
  };
}

export async function listAddresses(customerId: string): Promise<SavedAddress[]> {
  return db.savedAddress.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
}

export async function upsertCustomerAddress(
  customerId: string,
  input: AddressInput,
  opts?: { actorStaffId?: string | null },
): Promise<Result<{ address: SavedAddress; created: boolean }>> {
  const prepared = await prepare(input);
  if ("error" in prepared && prepared.error) {
    return err("validation", prepared.error);
  }
  const data = prepared.data!;

  const existing = await db.savedAddress.findUnique({
    where: {
      customerId_addressNorm: { customerId, addressNorm: data.addressNorm },
    },
  });

  if (existing) {
    const address = await db.savedAddress.update({
      where: { id: existing.id },
      data: {
        ...data,
        isDefault: data.isDefault || existing.isDefault,
      },
    });
    await db.auditLog.create({
      data: {
        action: opts?.actorStaffId
          ? AuditAction.ADDRESS_STAFF_EDITED
          : AuditAction.ADDRESS_UPDATED,
        actorId: opts?.actorStaffId ?? null,
        meta: {
          addressId: address.id,
          customerId,
          mode: "dedupe-update",
        },
      },
    });
    return ok({ address, created: false });
  }

  if (data.isDefault) {
    await db.savedAddress.updateMany({
      where: { customerId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const address = await db.savedAddress.create({
    data: { customerId, ...data },
  });
  await db.auditLog.create({
    data: {
      action: opts?.actorStaffId
        ? AuditAction.ADDRESS_STAFF_EDITED
        : AuditAction.ADDRESS_CREATED,
      actorId: opts?.actorStaffId ?? null,
      meta: { addressId: address.id, customerId, mode: "create" },
    },
  });
  return ok({ address, created: true });
}

export async function updateOwnedAddress(
  customerId: string,
  addressId: string,
  input: AddressInput,
  opts?: { actorStaffId?: string | null; bypassOwnership?: boolean },
): Promise<Result<{ address: SavedAddress }>> {
  const existing = await db.savedAddress.findUnique({ where: { id: addressId } });
  // Uniform not_found — never reveal ownership of another customer's address (M2).
  if (!existing || (!opts?.bypassOwnership && existing.customerId !== customerId)) {
    return err("not_found", "Address not found.");
  }

  const prepared = await prepare(input);
  if ("error" in prepared && prepared.error) {
    return err("validation", prepared.error);
  }
  const data = prepared.data!;

  const collision = await db.savedAddress.findFirst({
    where: {
      customerId: existing.customerId,
      addressNorm: data.addressNorm,
      NOT: { id: addressId },
    },
  });
  if (collision) {
    return err("duplicate", "Another saved address already matches this location.");
  }

  if (data.isDefault) {
    await db.savedAddress.updateMany({
      where: { customerId: existing.customerId, isDefault: true, NOT: { id: addressId } },
      data: { isDefault: false },
    });
  }

  const address = await db.savedAddress.update({
    where: { id: addressId },
    data,
  });

  await db.auditLog.create({
    data: {
      action: opts?.actorStaffId
        ? AuditAction.ADDRESS_STAFF_EDITED
        : AuditAction.ADDRESS_UPDATED,
      actorId: opts?.actorStaffId ?? null,
      meta: {
        addressId: address.id,
        customerId: existing.customerId,
        mode: "edit",
        staff: Boolean(opts?.actorStaffId),
      } satisfies Prisma.InputJsonValue,
    },
  });

  return ok({ address });
}
