import { FulfillmentMethod, Order, Package, PackageLine, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { getOpenSeason } from "@/lib/seasons/queries";
import { PackageConcurrencyError, PackageEventAction } from "@/lib/packages/stages";

// UR-001/G-003: staff split and regroup. Both are membership moves between
// physical boxes; the grouping identity (recipient/address/method/greeting)
// never changes on split, and regroup is scoped to one order so a box can
// never absorb another order's lines.

export interface PackageMoveInput {
  orderLineId: string;
  qty: number;
}

type PackageWithLines = Package & {
  lines: PackageLine[];
  fulfillmentMethod: FulfillmentMethod;
  order: Pick<Order, "seasonId">;
};

// Season-scoped like the bulk path: a past season's package ids are treated
// as nonexistent rather than mutable.
async function loadPackage(tx: Prisma.TransactionClient, packageId: string, seasonId: string): Promise<PackageWithLines> {
  const pkg = await tx.package.findUnique({
    where: { id: packageId },
    include: { lines: true, fulfillmentMethod: true, order: { select: { seasonId: true } } },
  });
  if (!pkg || pkg.order.seasonId !== seasonId) throw new NotFoundError("Package", packageId);
  return pkg;
}

async function requireOpenSeason(verb: string) {
  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError(`No open season — ${verb} only acts on the open season's packages`);
  return season;
}

function assertNotTerminal(pkg: PackageWithLines, verb: string): void {
  if (pkg.stage === pkg.fulfillmentMethod.terminalStage) {
    throw new DomainRuleError(
      `Cannot ${verb} package ${pkg.id}: it is already ${pkg.stage} (terminal for ${pkg.fulfillmentMethod.code}); expected a non-terminal stage`,
    );
  }
}

// Moves are validated against the source's current contents; duplicates and
// over-moves are refused instead of silently clamped.
function assertMovesValid(source: PackageWithLines, moves: PackageMoveInput[]): void {
  if (moves.length === 0) {
    throw new DomainRuleError("No moves given; expected at least one line qty to move");
  }
  const seen = new Set<string>();
  for (const move of moves) {
    if (!Number.isInteger(move.qty) || move.qty < 1) {
      throw new DomainRuleError(`Move qty must be a positive integer; got ${move.qty} for line ${move.orderLineId}`);
    }
    if (seen.has(move.orderLineId)) {
      throw new DomainRuleError(`Line ${move.orderLineId} appears twice in the move list; merge it into one move`);
    }
    seen.add(move.orderLineId);
    const line = source.lines.find((candidate) => candidate.orderLineId === move.orderLineId);
    if (!line) {
      throw new DomainRuleError(`Line ${move.orderLineId} is not in package ${source.id}; expected one of its current lines`);
    }
    if (move.qty > line.qty) {
      throw new DomainRuleError(`Cannot move ${move.qty} of line ${move.orderLineId}; package ${source.id} holds ${line.qty}`);
    }
  }
}

async function bumpVersionOrThrow(tx: Prisma.TransactionClient, packageId: string, expectedVersion: number): Promise<void> {
  const updated = await tx.package.updateMany({
    where: { id: packageId, version: expectedVersion },
    data: { version: { increment: 1 } },
  });
  if (updated.count === 0) throw new PackageConcurrencyError(packageId);
}

// Applies validated moves from source into destination (upserting rows there).
// Returns the units remaining on the source.
async function applyMoves(
  tx: Prisma.TransactionClient,
  sourceId: string,
  destinationId: string,
  moves: PackageMoveInput[],
): Promise<number> {
  let remaining = 0;
  const sourceLines = await tx.packageLine.findMany({ where: { packageId: sourceId } });
  for (const line of sourceLines) {
    const move = moves.find((candidate) => candidate.orderLineId === line.orderLineId);
    const movedQty = move?.qty ?? 0;
    const leftQty = line.qty - movedQty;
    if (movedQty > 0) {
      await tx.packageLine.upsert({
        where: { packageId_orderLineId: { packageId: destinationId, orderLineId: line.orderLineId } },
        update: { qty: { increment: movedQty } },
        create: { packageId: destinationId, orderLineId: line.orderLineId, qty: movedQty },
      });
      if (leftQty === 0) {
        await tx.packageLine.delete({ where: { id: line.id } });
      } else {
        await tx.packageLine.update({ where: { id: line.id }, data: { qty: leftQty } });
      }
    }
    remaining += leftQty;
  }
  return remaining;
}

// Split: chosen line qtys move into a NEW package with the same grouping
// identity (a second physical box for the same recipient/method/greeting).
// The source must keep at least one unit — emptying a package is a regroup.
export async function splitPackage(input: {
  packageId: string;
  expectedVersion: number;
  moves: PackageMoveInput[];
  actorId?: string;
}): Promise<Package> {
  const season = await requireOpenSeason("split");
  return prisma.$transaction(async (tx) => {
    const source = await loadPackage(tx, input.packageId, season.id);
    assertNotTerminal(source, "split");
    assertMovesValid(source, input.moves);
    const totalUnits = source.lines.reduce((sum, line) => sum + line.qty, 0);
    const movingUnits = input.moves.reduce((sum, move) => sum + move.qty, 0);
    if (movingUnits >= totalUnits) {
      throw new DomainRuleError(
        `Split must leave at least one unit in package ${source.id}; to move everything, regroup into an existing package`,
      );
    }

    await bumpVersionOrThrow(tx, source.id, input.expectedVersion);
    const created = await tx.package.create({
      data: {
        orderId: source.orderId,
        recipientName: source.recipientName,
        recipientAddressId: source.recipientAddressId,
        fulfillmentMethodId: source.fulfillmentMethodId,
        greeting: source.greeting,
        groupingKey: source.groupingKey,
        channel: source.channel,
        deliveryDay: source.deliveryDay,
      },
    });
    await applyMoves(tx, source.id, created.id, input.moves);

    const action: PackageEventAction = "split";
    const movesJson = input.moves as unknown as Prisma.InputJsonValue;
    await tx.packageEvent.create({
      data: {
        packageId: source.id,
        action,
        actorId: input.actorId ?? null,
        metadata: { newPackageId: created.id, moves: movesJson },
      },
    });
    await tx.packageEvent.create({
      data: {
        packageId: created.id,
        action,
        actorId: input.actorId ?? null,
        metadata: { fromPackageId: source.id, moves: movesJson },
      },
    });
    return created;
  });
}

// Regroup: lines move from the source into another package of the SAME order.
// A source emptied this way is absorbed — its row is removed; the story lives
// on the target's event trail and the global audit log.
export async function regroupPackage(input: {
  packageId: string;
  targetPackageId: string;
  expectedVersion: number;
  moves: PackageMoveInput[];
  actorId?: string;
}): Promise<{ absorbed: boolean }> {
  const season = await requireOpenSeason("regroup");
  return prisma.$transaction(async (tx) => {
    if (input.packageId === input.targetPackageId) {
      throw new DomainRuleError("Source and target are the same package; expected two different packages");
    }
    const source = await loadPackage(tx, input.packageId, season.id);
    const target = await loadPackage(tx, input.targetPackageId, season.id);
    assertNotTerminal(source, "regroup out of");
    assertNotTerminal(target, "regroup into");
    if (source.orderId !== target.orderId) {
      throw new DomainRuleError(
        `Regroup stays inside one order: package ${source.id} is on order ${source.orderId}, target on ${target.orderId}`,
      );
    }
    assertMovesValid(source, input.moves);

    await bumpVersionOrThrow(tx, source.id, input.expectedVersion);
    await tx.package.update({ where: { id: target.id }, data: { version: { increment: 1 } } });
    const remaining = await applyMoves(tx, source.id, target.id, input.moves);
    const absorbed = remaining === 0;

    const action: PackageEventAction = "regroup";
    const movesJson = input.moves as unknown as Prisma.InputJsonValue;
    await tx.packageEvent.create({
      data: {
        packageId: target.id,
        action,
        actorId: input.actorId ?? null,
        metadata: { fromPackageId: source.id, moves: movesJson, absorbed },
      },
    });
    if (!absorbed) {
      await tx.packageEvent.create({
        data: {
          packageId: source.id,
          action,
          actorId: input.actorId ?? null,
          metadata: { toPackageId: target.id, moves: movesJson },
        },
      });
    } else {
      await tx.package.delete({ where: { id: source.id } });
    }
    return { absorbed };
  });
}
