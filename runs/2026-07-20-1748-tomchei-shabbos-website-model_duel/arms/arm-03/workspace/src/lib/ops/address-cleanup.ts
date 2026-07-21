import { AuditAction } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { buildAddressNorm, validateAddressInput } from "@/lib/address/normalize";
import { err, maskError, ok, type Result } from "@/lib/result";

export type AddressReviewItem = {
  id: string;
  customerId: string;
  recipientName: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  addressNorm: string;
  needsReview: boolean;
  reviewReason: string | null;
  customerName: string;
};

/** Flag invalid / near-duplicate addresses onto the staff review queue (UR-014). */
export async function runAddressCleanup(input?: {
  staffId?: string | null;
  customerId?: string;
}): Promise<
  Result<{ flagged: number; mergedCandidates: number; reviewed: AddressReviewItem[] }>
> {
  try {
    const addresses = await db.savedAddress.findMany({
      where: {
        mergedIntoId: null,
        ...(input?.customerId ? { customerId: input.customerId } : {}),
      },
      include: { customer: { select: { displayName: true } } },
      take: 20_000,
    });

    let flagged = 0;
    let mergedCandidates = 0;
    const byCustomerNorm = new Map<string, typeof addresses>();

    for (const addr of addresses) {
      const key = `${addr.customerId}|${addr.addressNorm}`;
      const bucket = byCustomerNorm.get(key) ?? [];
      bucket.push(addr);
      byCustomerNorm.set(key, bucket);

      const validation = validateAddressInput({
        recipientName: addr.recipientName,
        line1: addr.line1,
        line2: addr.line2,
        city: addr.city,
        state: addr.state,
        postalCode: addr.postalCode,
        country: addr.country,
      });

      const recomputed = buildAddressNorm({
        recipientName: addr.recipientName,
        line1: addr.line1,
        line2: addr.line2,
        city: addr.city,
        state: addr.state,
        postalCode: addr.postalCode,
        country: addr.country,
      });

      const reasons: string[] = [];
      if (validation) reasons.push(validation);
      if (recomputed !== addr.addressNorm) reasons.push("norm_mismatch");
      if (!addr.latitude || !addr.longitude) reasons.push("ungeocoded");

      if (reasons.length && !addr.needsReview) {
        await db.savedAddress.update({
          where: { id: addr.id },
          data: {
            needsReview: true,
            reviewReason: reasons.join("; "),
          },
        });
        flagged += 1;
        await writeAudit({
          action: AuditAction.ADDRESS_REVIEW_FLAGGED,
          actorId: input?.staffId ?? null,
          meta: { addressId: addr.id, reasons },
        });
      }
    }

    for (const [, bucket] of byCustomerNorm) {
      if (bucket.length > 1) {
        mergedCandidates += bucket.length - 1;
        for (const dup of bucket.slice(1)) {
          if (!dup.needsReview) {
            await db.savedAddress.update({
              where: { id: dup.id },
              data: {
                needsReview: true,
                reviewReason: `duplicate_of:${bucket[0]!.id}`,
              },
            });
            flagged += 1;
          }
        }
      }
    }

    const reviewed = await listAddressReviewQueue(200);
    return ok({ flagged, mergedCandidates, reviewed });
  } catch (error) {
    return err(maskError(error), "Address cleanup failed.");
  }
}

export async function listAddressReviewQueue(limit = 100): Promise<AddressReviewItem[]> {
  const rows = await db.savedAddress.findMany({
    where: { needsReview: true, mergedIntoId: null },
    include: { customer: { select: { displayName: true } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    recipientName: r.recipientName,
    line1: r.line1,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    addressNorm: r.addressNorm,
    needsReview: r.needsReview,
    reviewReason: r.reviewReason,
    customerName: r.customer.displayName,
  }));
}

/** Merge source into target (same customer); re-point lines/packages. */
export async function mergeAddresses(input: {
  sourceId: string;
  targetId: string;
  staffId: string;
}): Promise<Result<{ targetId: string; sourceId: string }>> {
  try {
    if (input.sourceId === input.targetId) {
      return err("same", "Source and target must differ.");
    }
    const [source, target] = await Promise.all([
      db.savedAddress.findUnique({ where: { id: input.sourceId } }),
      db.savedAddress.findUnique({ where: { id: input.targetId } }),
    ]);
    if (!source || !target) return err("missing", "Address not found.");
    if (source.customerId !== target.customerId) {
      return err("customer", "Addresses must belong to the same customer.");
    }

    await db.$transaction(async (tx) => {
      await tx.orderLine.updateMany({
        where: { savedAddressId: source.id },
        data: { savedAddressId: target.id },
      });
      await tx.package.updateMany({
        where: { savedAddressId: source.id },
        data: { savedAddressId: target.id },
      });
      await tx.savedAddress.update({
        where: { id: source.id },
        data: {
          mergedIntoId: target.id,
          needsReview: false,
          reviewReason: `merged_into:${target.id}`,
        },
      });
      await tx.savedAddress.update({
        where: { id: target.id },
        data: { needsReview: false, reviewReason: null },
      });
      await writeAudit(
        {
          action: AuditAction.ADDRESS_MERGED,
          actorId: input.staffId,
          meta: { sourceId: source.id, targetId: target.id },
        },
        tx,
      );
    });

    return ok({ targetId: target.id, sourceId: source.id });
  } catch (error) {
    return err(maskError(error), "Could not merge addresses.");
  }
}
