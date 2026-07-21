import {
  AuditAction,
  PackageStage,
  type Package,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";

type Tx = Prisma.TransactionClient;

const ALLOWED: Record<PackageStage, ReadonlySet<PackageStage>> = {
  [PackageStage.NEW]: new Set([PackageStage.PRINTED]),
  [PackageStage.PRINTED]: new Set([PackageStage.PACKED]),
  [PackageStage.PACKED]: new Set([PackageStage.SENT, PackageStage.PICKED_UP]),
  [PackageStage.SENT]: new Set(),
  [PackageStage.PICKED_UP]: new Set(),
};

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
): Promise<Package> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Package" WHERE id = ${packageId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new Error(`Package ${packageId} not found`);
  }
  return tx.package.findUniqueOrThrow({ where: { id: packageId } });
}

/** Optimistic package stage transition (Q-F3). */
export async function transitionPackage(
  packageId: string,
  to: PackageStage,
  actorId?: string | null,
  expectedVersion?: number,
): Promise<Result<{ package: Package }>> {
  try {
    const result = await db.$transaction(async (tx) => {
      const pkg = await lockPackageForUpdate(tx, packageId);
      assertPackageTransition(pkg.stage, to);

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
    return ok(result);
  } catch (error) {
    return err(maskError(error), "Could not transition package.");
  }
}
