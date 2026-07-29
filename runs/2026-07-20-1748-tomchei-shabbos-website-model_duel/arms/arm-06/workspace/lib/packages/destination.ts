import { Address, DraftRecipient, OrderLine, Package, PackageLine } from "@prisma/client";
import { DomainRuleError } from "@/lib/errors";
import { normalizedAddressKey } from "@/lib/routes/geo";

// P9 destination snapshot shared by the route builder, the reroute
// suggestion engine, and the method switch. Book address first (a delivery
// recipient linked one); guests fall back to the draft recipient's inline
// snapshot, which is non-null by construction. A merged package only groups
// recipients who share one destination, and this asserts it stays that way —
// the same law the P8 label path enforces for SHIPPED.

export type PackageForDestination = Package & {
  recipientAddress: Address | null;
  lines: (PackageLine & { orderLine: OrderLine & { recipient: DraftRecipient | null } })[];
};

export interface DestinationSnapshot {
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export function destinationSnapshotFor(pkg: PackageForDestination): DestinationSnapshot {
  if (!pkg.recipientAddress) {
    const members = pkg.lines
      .map((line) => line.orderLine.recipient)
      .filter((recipient): recipient is DraftRecipient => recipient !== null);
    const distinctKeys = new Set(members.map(normalizedAddressKey));
    if (distinctKeys.size > 1) {
      throw new DomainRuleError(
        `Package ${pkg.id} merges recipients with different addresses; expected one shared destination`,
      );
    }
  }
  const source = pkg.recipientAddress ?? pkg.lines[0]?.orderLine.recipient ?? null;
  if (!source) {
    throw new DomainRuleError(`Package ${pkg.id} has no recipient address; expected one for delivery routing`);
  }
  return {
    line1: source.line1,
    line2: source.line2,
    city: source.city,
    region: source.region,
    postalCode: source.postalCode,
    country: source.country,
  };
}
