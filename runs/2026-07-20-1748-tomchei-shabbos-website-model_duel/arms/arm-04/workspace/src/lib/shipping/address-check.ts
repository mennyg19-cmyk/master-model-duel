import 'server-only';

import { recordAudit, type AuditActor } from '../audit';
import type { DbClient } from '../core/db-client';
import { failure, ok, type Result } from '../core/result';
import { boardScopeWhere } from '../fulfillment/channel-summary';
import { toShippingAddress } from './address-mapping';
import { getShippingProvider } from './provider';

/**
 * Asking the carrier whether a destination exists, before a label is bought
 * against it (R-177).
 *
 * The verdict is written on the package rather than on the address book row: the
 * box is what is being shipped, and it is the box the packing table is looking
 * at. It is advisory on purpose — a carrier that cannot match a new development
 * is wrong often enough that refusing to ship on its word would strand real
 * deliveries.
 */
export const ADDRESS_NOT_CHECKABLE = 'address_not_checkable';

export async function validatePackageAddress(
  client: DbClient,
  actor: AuditActor,
  input: { packageId: string; seasonId: string },
): Promise<Result<{ isValid: boolean; note: string }>> {
  const box = await client.package.findFirst({
    where: { id: input.packageId, ...boardScopeWhere(input.seasonId) },
    select: {
      id: true,
      recipientName: true,
      fulfillmentMethod: { select: { kind: true } },
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressState: true,
      addressPostalCode: true,
      addressCountry: true,
    },
  });

  if (!box) {
    return failure(ADDRESS_NOT_CHECKABLE, 'That package is not on the packing board for this season.');
  }

  if (box.fulfillmentMethod.kind !== 'SHIPPING') {
    return failure(
      ADDRESS_NOT_CHECKABLE,
      'This box is not going by carrier, so there is no carrier to ask about its address.',
    );
  }

  const address = toShippingAddress(box, { name: box.recipientName });

  if (!address) {
    return failure(
      ADDRESS_NOT_CHECKABLE,
      'This box has no complete address to check. A pickup box has none by design.',
    );
  }

  const verdict = await getShippingProvider().validateAddress(address);

  await client.package.update({
    where: { id: box.id },
    data: {
      addressValidatedAt: new Date(),
      addressIsValid: verdict.isValid,
      addressValidationNote: verdict.note,
    },
  });

  await recordAudit(
    actor,
    {
      action: 'shipping.address_validated',
      entityType: 'Package',
      entityId: box.id,
      detail: { isValid: verdict.isValid, postalCode: address.postalCode },
    },
    client,
  );

  return ok(verdict);
}
