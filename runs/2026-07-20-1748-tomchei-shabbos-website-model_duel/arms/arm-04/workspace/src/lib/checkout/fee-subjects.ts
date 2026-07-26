import 'server-only';

import type { DbClient } from '../core/db-client';
import { deliveryDestinationKey, type PackageDestination } from '../orders/grouping';
import type { FeeSubject } from './fees';

/**
 * What the fee engine needs about each package: the method's rule, and the door
 * it is going to.
 *
 * Checkout quotes from cart groups and finalize charges from package rows, and
 * the two have to agree to the cent (R-037). They disagree about one thing only
 * — what identifies a package — so the caller brings its own key and everything
 * else is read the same way for both.
 */
export async function feeSubjectsFrom(
  client: DbClient,
  packages: { key: string; destination: PackageDestination }[],
): Promise<FeeSubject[]> {
  const methodIds = [...new Set(packages.map((row) => row.destination.fulfillmentMethodId))];
  const methods = await client.fulfillmentMethod.findMany({
    where: { id: { in: methodIds } },
    select: { id: true, label: true, kind: true, feeBasis: true, baseFeeCents: true },
  });

  const methodById = new Map(methods.map((method) => [method.id, method]));

  return packages.map((row) => {
    const method = methodById.get(row.destination.fulfillmentMethodId);

    // The FK is RESTRICT, so a missing row means the methods were read outside
    // this caller's transaction, not that a package may be charged nothing.
    if (!method) {
      throw new Error(
        `Fulfillment method ${row.destination.fulfillmentMethodId} is named by package ${row.key} but was not read with the others.`,
      );
    }

    return { key: row.key, method, destinationKey: deliveryDestinationKey(row.destination) };
  });
}
