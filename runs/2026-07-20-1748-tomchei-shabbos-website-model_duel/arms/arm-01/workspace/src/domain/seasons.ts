import { Prisma, type PrismaClient, type SeasonStatus } from "@prisma/client";

export async function applyScheduledSeasonStatuses(
  prisma: PrismaClient,
  now = new Date(),
) {
  const dueSeasons = await prisma.season.findMany({
    where: {
      scheduledStatus: { not: null },
      scheduledStatusAt: { lte: now },
    },
    orderBy: [{ scheduledStatusAt: "asc" }, { id: "asc" }],
  });
  let applied = 0;

  for (const season of dueSeasons) {
    if (!season.scheduledStatus || !season.scheduledStatusAt) continue;
    const scheduledStatus = season.scheduledStatus;
    const didApply = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.season.updateMany({
        where: {
          id: season.id,
          scheduledStatus: season.scheduledStatus,
          scheduledStatusAt: season.scheduledStatusAt,
        },
        data: {
          status: scheduledStatus,
          scheduledStatus: null,
          scheduledStatusAt: null,
        },
      });
      if (updated.count !== 1) return false;
      if (scheduledStatus === "OPEN") {
        await transaction.season.updateMany({
          where: { id: { not: season.id }, status: "OPEN" },
          data: { status: "CLOSED" },
        });
        await transaction.appSetting.upsert({
          where: { key: "current-season-id" },
          update: { value: season.id },
          create: { key: "current-season-id", value: season.id },
        });
      }
      await transaction.auditLog.create({
        data: {
          action: "season.status_auto_flipped",
          targetType: "Season",
          targetId: season.id,
          metadata: { status: scheduledStatus, scheduledFor: season.scheduledStatusAt },
        },
      });
      return true;
    });
    if (didApply) applied += 1;
  }
  return applied;
}

export async function setSeasonStatus(
  prisma: PrismaClient,
  input: {
    seasonId: string;
    status: SeasonStatus;
    actorStaffId: string;
  },
) {
  return prisma.$transaction(async (transaction) => {
    if (input.status === "OPEN") {
      await transaction.season.updateMany({
        where: { id: { not: input.seasonId }, status: "OPEN" },
        data: { status: "CLOSED" },
      });
    }
    const season = await transaction.season.update({
      where: { id: input.seasonId },
      data: {
        status: input.status,
        scheduledStatus: null,
        scheduledStatusAt: null,
      },
    });
    await transaction.appSetting.upsert({
      where: { key: "current-season-id" },
      update: { value: season.id },
      create: { key: "current-season-id", value: season.id },
    });
    await transaction.auditLog.create({
      data: {
        actorStaffId: input.actorStaffId,
        action: "season.status_changed",
        targetType: "Season",
        targetId: season.id,
        metadata: { status: season.status },
      },
    });
    return season;
  });
}

export async function scheduleSeasonStatus(
  prisma: PrismaClient,
  input: {
    seasonId: string;
    status: SeasonStatus;
    scheduledAt: Date;
    actorStaffId: string;
  },
) {
  if (!Number.isFinite(input.scheduledAt.getTime())) {
    throw new Error("Scheduled season time is invalid.");
  }
  const season = await prisma.season.update({
    where: { id: input.seasonId },
    data: {
      scheduledStatus: input.status,
      scheduledStatusAt: input.scheduledAt,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorStaffId: input.actorStaffId,
      action: "season.status_scheduled",
      targetType: "Season",
      targetId: season.id,
      metadata: {
        status: input.status,
        scheduledAt: input.scheduledAt.toISOString(),
      },
    },
  });
  return season;
}

export async function createSeasonFromTemplate(
  prisma: PrismaClient,
  input: {
    name: string;
    year: number;
    sourceSeasonId?: string;
    actorStaffId: string;
  },
) {
  if (!input.name.trim() || !Number.isInteger(input.year)) {
    throw new Error("Season name and a whole-number year are required.");
  }
  const source = input.sourceSeasonId
    ? await prisma.season.findUnique({
        where: { id: input.sourceSeasonId },
        include: {
          products: {
            include: {
              options: true,
              inventoryItem: true,
              addOnInventoryItem: true,
            },
          },
          fulfillmentMethods: true,
          packageTypes: true,
          pickupLocations: true,
        },
      })
    : null;
  if (input.sourceSeasonId && !source) {
    throw new Error("The template season was not found.");
  }
  if (source && input.year <= source.year) {
    throw new Error("A new season year must be later than its template.");
  }

  return prisma.$transaction(async (transaction) => {
    const season = await transaction.season.create({
      data: {
        name: input.name.trim(),
        year: input.year,
        status: "CLOSED",
        fulfillmentMethods: source
          ? {
              create: source.fulfillmentMethods.map((method) => ({
                code: method.code,
                displayName: method.displayName,
                requiresAddress: method.requiresAddress,
                isPickup: method.isPickup,
                isShipping: method.isShipping,
                isActive: method.isActive,
                sortOrder: method.sortOrder,
              })),
            }
          : undefined,
        packageTypes: source
          ? {
              create: source.packageTypes.map((packageType) => ({
                name: packageType.name,
                innerWidthMm: packageType.innerWidthMm,
                innerHeightMm: packageType.innerHeightMm,
                innerDepthMm: packageType.innerDepthMm,
                maxWeightGrams: packageType.maxWeightGrams,
                isActive: packageType.isActive,
              })),
            }
          : undefined,
        pickupLocations: source
          ? {
              create: source.pickupLocations.map((location) => ({
                name: location.name,
                address: location.address as Prisma.InputJsonValue,
                instructions: location.instructions,
                isActive: location.isActive,
              })),
            }
          : undefined,
      },
    });
    const productIds = new Map<string, string>();
    for (const product of source?.products ?? []) {
      const clonedProduct = await transaction.product.create({
        data: {
          seasonId: season.id,
          sku: product.sku,
          name: product.name,
          description: product.description,
          category: product.category,
          imageUrl: product.imageUrl,
          kind: product.kind,
          priceCents: product.priceCents,
          widthMm: product.widthMm,
          heightMm: product.heightMm,
          depthMm: product.depthMm,
          weightGrams: product.weightGrams,
          tracksInventory: product.tracksInventory,
          isFinishedPackage: product.isFinishedPackage,
          isActive: product.isActive,
          options: {
            create: product.options.map((option) => ({
              name: option.name,
              value: option.value,
              priceAdjustmentCents: option.priceAdjustmentCents,
              isDefault: option.isDefault,
              isActive: option.isActive,
            })),
          },
          ...(product.inventoryItem
            ? {
                inventoryItem: {
                  create: {
                    targetKind: "PRODUCT",
                    onHand: 0,
                    reserved: 0,
                  },
                },
              }
            : {}),
          ...(product.addOnInventoryItem
            ? {
                addOnInventoryItem: {
                  create: {
                    targetKind: "ADD_ON",
                    onHand: 0,
                    reserved: 0,
                  },
                },
              }
            : {}),
        },
      });
      productIds.set(product.id, clonedProduct.id);
      await transaction.product.update({
        where: { id: product.id },
        data: {
          replacementProductId: clonedProduct.id,
          version: { increment: 1 },
        },
      });
    }
    if (source) {
      const allowedAddOns = await transaction.productAllowedAddOn.findMany({
        where: { productId: { in: source.products.map((product) => product.id) } },
      });
      await transaction.productAllowedAddOn.createMany({
        data: allowedAddOns.flatMap((allowed) => {
          const productId = productIds.get(allowed.productId);
          const addOnId = productIds.get(allowed.addOnId);
          return productId && addOnId ? [{ productId, addOnId }] : [];
        }),
      });
    }
    await transaction.season.updateMany({
      where: { id: { not: season.id }, status: "OPEN" },
      data: { status: "CLOSED" },
    });
    await transaction.appSetting.upsert({
      where: { key: "current-season-id" },
      update: { value: season.id },
      create: { key: "current-season-id", value: season.id },
    });
    await transaction.auditLog.create({
      data: {
        actorStaffId: input.actorStaffId,
        action: "season.created",
        targetType: "Season",
        targetId: season.id,
        metadata: {
          sourceSeasonId: source?.id,
          clonedProductCount: productIds.size,
        },
      },
    });
    return season;
  });
}
