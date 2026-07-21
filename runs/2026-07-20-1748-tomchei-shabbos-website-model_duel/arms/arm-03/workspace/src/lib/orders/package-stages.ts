import {
  AuditAction,
  PackageStage,
  type Package,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";
import { requirePackageInSeasonLocked } from "@/lib/orders/lock";

type Tx = Prisma.TransactionClient;

const ALLOWED: Record<PackageStage, ReadonlySet<PackageStage>> = {
  [PackageStage.NEW]: new Set([PackageStage.PRINTED]),
  [PackageStage.PRINTED]: new Set([PackageStage.PACKED]),
  [PackageStage.PACKED]: new Set([PackageStage.SENT, PackageStage.PICKED_UP]),
  [PackageStage.SENT]: new Set(),
  [PackageStage.PICKED_UP]: new Set(),
};

/** PICKUP → PICKED_UP only; everything else → SENT. */
export function terminalStageForMethodCode(code: string): PackageStage {
  return code.toUpperCase() === "PICKUP" ? PackageStage.PICKED_UP : PackageStage.SENT;
}

export function assertMethodTerminal(
  methodCode: string,
  toStage: PackageStage,
): void {
  if (toStage !== PackageStage.SENT && toStage !== PackageStage.PICKED_UP) return;
  const allowed = terminalStageForMethodCode(methodCode);
  if (toStage !== allowed) {
    throw new Error(
      methodCode.toUpperCase() === "PICKUP"
        ? "Pickup packages use PICKED_UP, not SENT"
        : "Only pickup packages can be marked PICKED_UP",
    );
  }
}

export function canTransitionPackage(
  from: PackageStage,
  to: PackageStage,
): boolean {
  return ALLOWED[from].has(to);
}

export function assertPackageTransition(
  from: PackageStage,
  to: PackageStage,
): void {
  if (!canTransitionPackage(from, to)) {
    throw new Error(
      `Illegal package stage ${from} → ${to}. Expected one of: ${[...ALLOWED[from]].join(", ") || "(none)"}`,
    );
  }
}

export function allowedPackageTransitions(from: PackageStage): PackageStage[] {
  return [...ALLOWED[from]];
}

async function lockPackageForUpdate(
  tx: Tx,
  packageId: string,
  seasonId: string,
): Promise<Package & { fulfillmentMethod: { code: string } }> {
  await requirePackageInSeasonLocked(tx, packageId, seasonId);
  return tx.package.findUniqueOrThrow({
    where: { id: packageId },
    include: { fulfillmentMethod: { select: { code: true } } },
  });
}

/** Optimistic package stage transition (Q-F3) — season-scoped + method-terminal. */
export async function transitionPackage(
  seasonId: string,
  packageId: string,
  to: PackageStage,
  actorId?: string | null,
  expectedVersion?: number,
): Promise<Result<{ package: Package }>> {
  try {
    const outcome = await db.$transaction(async (tx) => {
      const pkg = await lockPackageForUpdate(tx, packageId, seasonId);
      assertPackageTransition(pkg.stage, to);
      assertMethodTerminal(pkg.fulfillmentMethod.code, to);

      const version = expectedVersion ?? pkg.version;
      const updated = await tx.package.update({
        where: { id: packageId, version },
        data: {
          stage: to,
          version: { increment: 1 },
        },
      });

      await tx.packageAuditLog.create({
        data: {
          packageId,
          actorId: actorId ?? null,
          fromStage: pkg.stage,
          toStage: to,
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.PACKAGE_STAGE_CHANGED,
          actorId: actorId ?? null,
          meta: {
            packageId,
            from: pkg.stage,
            to,
            versionBefore: pkg.version,
            versionAfter: updated.version,
          },
        },
      });

      return { package: updated };
    });
    return ok(outcome);
  } catch (error) {
    return err(maskError(error), "Could not transition package.");
  }
}
