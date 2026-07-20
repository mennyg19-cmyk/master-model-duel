import { PackageStage, PrismaClient } from "@prisma/client";

const ALLOWED_PACKAGE_TRANSITIONS: Readonly<
  Record<PackageStage, readonly PackageStage[]>
> = {
  NEW: [PackageStage.PRINTED, PackageStage.PACKED],
  PRINTED: [PackageStage.PACKED],
  PACKED: [PackageStage.SENT, PackageStage.PICKED_UP],
  SENT: [],
  PICKED_UP: [],
};

export async function advancePackageStage(
  prisma: PrismaClient,
  packageId: string,
  expectedVersion: number,
  toStage: PackageStage,
  actorStaffId?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const currentPackage = await transaction.package.findUniqueOrThrow({
      where: { id: packageId },
      select: { stage: true },
    });

    if (!ALLOWED_PACKAGE_TRANSITIONS[currentPackage.stage].includes(toStage)) {
      throw new Error(
        `Package cannot transition from ${currentPackage.stage} to ${toStage}.`,
      );
    }

    const changed = await transaction.package.updateMany({
      where: { id: packageId, version: expectedVersion },
      data: { stage: toStage, version: { increment: 1 } },
    });
    if (changed.count !== 1) {
      throw new Error("Package update lost a concurrent mutation.");
    }

    await transaction.packageAudit.create({
      data: {
        packageId,
        actorStaffId,
        action: "stage.changed",
        fromStage: currentPackage.stage,
        toStage,
      },
    });
  });
}
