import { Package, PackageStage } from "@prisma/client";
import { prisma, reloadOrThrow } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";

// Stage advance is data-driven (R-153): the fulfillment method owns its stage
// list, so DELIVERY can run NEW→PRINTED→PACKED→SENT while PICKUP skips
// printing. Forward-only inside the method's list; terminal stage ends it.
export class IllegalStageTransitionError extends Error {
  constructor(from: PackageStage, to: PackageStage, methodCode: string) {
    // ASCII arrow (WIN1252-encoded embedded DB — see IllegalTransitionError).
    super(`Illegal package stage transition on ${methodCode}: ${from} -> ${to}`);
    this.name = "IllegalStageTransitionError";
  }
}

export class PackageConcurrencyError extends Error {
  constructor(packageId: string) {
    super(`Package ${packageId} was changed concurrently; reload and retry`);
    this.name = "PackageConcurrencyError";
  }
}

// PackageEvent action discriminator — typed union mirroring AuditAction in
// lib/audit.ts (one typing discipline per concern). Every event write uses a
// member of this union; new event kinds extend it here.
export type PackageEventAction = "stage_advance";

const PACKAGE_STAGES: readonly PackageStage[] = ["NEW", "PRINTED", "PACKED", "SENT", "PICKED_UP"];

// FulfillmentMethod.stages is an unvalidated Json column: validate-or-throw on
// read so a bad seed/admin write fails loudly (naming the method) instead of
// silently bricking every advance for that method.
export function parseMethodStages(raw: unknown, methodCode: string): PackageStage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DomainRuleError(
      `Fulfillment method ${methodCode} has an invalid stage list; expected a non-empty array of stages`,
    );
  }
  for (const stage of raw) {
    if (typeof stage !== "string" || !PACKAGE_STAGES.includes(stage as PackageStage)) {
      throw new DomainRuleError(
        `Fulfillment method ${methodCode} has an unknown stage ${JSON.stringify(stage)}; expected one of ${PACKAGE_STAGES.join(", ")}`,
      );
    }
  }
  return raw as PackageStage[];
}

export function canAdvanceStage(
  from: PackageStage,
  to: PackageStage,
  methodStages: readonly PackageStage[],
): boolean {
  const fromIndex = methodStages.indexOf(from);
  const toIndex = methodStages.indexOf(to);
  return fromIndex !== -1 && toIndex !== -1 && toIndex > fromIndex;
}

export function assertCanAdvanceStage(
  from: PackageStage,
  to: PackageStage,
  methodStages: readonly PackageStage[],
  methodCode: string,
): void {
  if (!canAdvanceStage(from, to, methodStages)) {
    throw new IllegalStageTransitionError(from, to, methodCode);
  }
}

// Optimistic versioning on the package row + package-level audit event.
export async function advancePackageStage(input: {
  packageId: string;
  expectedVersion: number;
  to: PackageStage;
  actorId?: string;
}): Promise<Package> {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({
      where: { id: input.packageId },
      include: { fulfillmentMethod: true },
    });
    if (!pkg) throw new NotFoundError("Package", input.packageId);

    const methodStages = parseMethodStages(pkg.fulfillmentMethod.stages, pkg.fulfillmentMethod.code);
    assertCanAdvanceStage(pkg.stage, input.to, methodStages, pkg.fulfillmentMethod.code);

    const updated = await tx.package.updateMany({
      where: { id: input.packageId, version: input.expectedVersion },
      data: { stage: input.to, version: { increment: 1 } },
    });
    if (updated.count === 0) throw new PackageConcurrencyError(input.packageId);

    const action: PackageEventAction = "stage_advance";
    await tx.packageEvent.create({
      data: {
        packageId: input.packageId,
        action,
        fromStage: pkg.stage,
        toStage: input.to,
        actorId: input.actorId ?? null,
      },
    });
    return reloadOrThrow(
      () => tx.package.findUnique({ where: { id: input.packageId } }),
      "Package",
      input.packageId,
    );
  });
}
