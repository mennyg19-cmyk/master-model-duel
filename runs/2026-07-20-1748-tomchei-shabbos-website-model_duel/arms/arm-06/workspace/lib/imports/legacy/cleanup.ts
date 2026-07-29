import { Address } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { legacyAddressGroupKey } from "@/lib/imports/legacy/normalize";

// UR-014: address-book cleanup. Legacy imports surface two kinds of mess:
// near-duplicate addresses (punctuation drift — the loose group key catches
// them) and flagged rows (needsReview from import, e.g. unparseable ZIP).
// Merge keeps one row and drops the rest; draft carts hold an address
// snapshot so SetNull on their addressId loses nothing.

export interface BookGroup {
  key: string;
  addresses: Address[];
}

export interface BookScan {
  duplicates: BookGroup[];
  flagged: Address[];
}

export async function scanBook(customerId: string): Promise<BookScan> {
  const addresses = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ createdAt: "asc" }],
  });
  const groups = new Map<string, Address[]>();
  for (const address of addresses) {
    const key = legacyAddressGroupKey(address);
    const group = groups.get(key) ?? [];
    group.push(address);
    groups.set(key, group);
  }
  return {
    duplicates: [...groups.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([key, members]) => ({ key, addresses: members })),
    flagged: addresses.filter((address) => address.needsReview),
  };
}

export async function mergeAddresses(input: {
  customerId: string;
  keepId: string;
  dropIds: string[];
  ctx: AuditContextLike;
}): Promise<{ merged: number }> {
  return prisma.$transaction(async (tx) => {
    const keep = await tx.address.findUnique({ where: { id: input.keepId } });
    if (!keep || keep.customerId !== input.customerId) throw new NotFoundError("Address", input.keepId);
    const dropped = await tx.address.findMany({ where: { id: { in: input.dropIds } } });
    if (dropped.length !== input.dropIds.length) {
      throw new NotFoundError("Address", input.dropIds.join(","));
    }
    if (dropped.some((address) => address.customerId !== keep.customerId)) {
      throw new DomainRuleError("Merge only works inside one customer's address book");
    }
    if (input.dropIds.includes(input.keepId)) {
      throw new DomainRuleError("The kept address cannot also be dropped");
    }
    // Package.recipientAddress is RESTRICT: an address that shipped can never
    // be deleted, so it can never be merged away — edit it instead.
    const referenced = await tx.package.count({ where: { recipientAddressId: { in: input.dropIds } } });
    if (referenced > 0) {
      throw new DomainRuleError("A dropped address is referenced by shipped packages — keep it and edit the other one");
    }
    await tx.address.deleteMany({ where: { id: { in: input.dropIds } } });
    await recordAudit(
      {
        ctx: input.ctx,
        action: "address_merge",
        targetType: "Customer",
        targetId: keep.customerId,
        metadata: { keepId: input.keepId, dropIds: input.dropIds, merged: dropped.length },
      },
      tx,
    );
    return { merged: dropped.length };
  });
}

// A flagged address is resolved by a human looking at it: clear the flag
// (audited) once the value is confirmed or corrected through the normal edit.
export async function resolveReview(input: { customerId: string; addressId: string; ctx: AuditContextLike }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const address = await tx.address.findUnique({ where: { id: input.addressId } });
    if (!address || address.customerId !== input.customerId) throw new NotFoundError("Address", input.addressId);
    if (!address.needsReview) return;
    await tx.address.update({ where: { id: address.id }, data: { needsReview: false, reviewReason: null } });
    await recordAudit(
      {
        ctx: input.ctx,
        action: "address_review",
        targetType: "Address",
        targetId: address.id,
        metadata: { customerId: address.customerId, previousReason: address.reviewReason },
      },
      tx,
    );
  });
}
