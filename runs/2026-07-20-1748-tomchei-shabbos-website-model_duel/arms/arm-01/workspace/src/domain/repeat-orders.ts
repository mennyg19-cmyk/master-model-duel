import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const MAX_REPEAT_BATCH = 50;

export type RepeatLineDecision = {
  sourceLineId: string;
  productId: string | null;
  recipientAddressId: string;
};

export async function getRepeatTargetSeasonId(prisma: PrismaClient) {
  const setting = await prisma.appSetting.findUnique({
    where: { key: "current-season-id" },
  });
  if (typeof setting?.value !== "string") {
    throw new Error("A current season must be selected before repeating orders.");
  }
  return setting.value;
}

export async function resolveReplacementChain(
  prisma: PrismaClient,
  sourceProductId: string,
  targetSeasonId: string,
) {
  const visited = new Set<string>();
  let productId: string | null = sourceProductId;

  while (productId) {
    if (visited.has(productId)) {
      throw new Error("Replacement mapping contains a cycle.");
    }
    visited.add(productId);
    const product: {
      id: string;
      seasonId: string;
      replacementProductId: string | null;
      isActive: boolean;
    } | null = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        seasonId: true,
        replacementProductId: true,
        isActive: true,
      },
    });
    if (!product) return null;
    if (product.seasonId === targetSeasonId) {
      return product.isActive ? product.id : null;
    }
    productId = product.replacementProductId;
  }
  return null;
}

export async function assertReplacementMapping(
  prisma: PrismaClient,
  sourceProductId: string,
  replacementProductId: string,
) {
  const [source, replacement] = await Promise.all([
    prisma.product.findUnique({
      where: { id: sourceProductId },
      include: { season: { select: { year: true } } },
    }),
    prisma.product.findUnique({
      where: { id: replacementProductId },
      include: { season: { select: { year: true } } },
    }),
  ]);
  if (!source || !replacement) {
    throw new Error("Both replacement products must exist.");
  }
  if (source.kind !== replacement.kind) {
    throw new Error("A replacement must have the same catalog type.");
  }
  if (replacement.season.year <= source.season.year) {
    throw new Error("A replacement must belong to a later season.");
  }

  const visited = new Set([source.id]);
  let productId: string | null = replacement.id;
  while (productId) {
    if (visited.has(productId)) {
      throw new Error("Replacement mapping would create a cycle.");
    }
    visited.add(productId);
    productId = (
      await prisma.product.findUnique({
        where: { id: productId },
        select: { replacementProductId: true },
      })
    )?.replacementProductId ?? null;
  }
}

export async function getRepeatReview(
  prisma: PrismaClient,
  sourceOrderId: string,
  requestedTargetSeasonId?: string,
) {
  const targetSeasonId =
    requestedTargetSeasonId ?? (await getRepeatTargetSeasonId(prisma));
  const [sourceOrder, targetSeason] = await Promise.all([
    prisma.order.findFirst({
      where: { id: sourceOrderId, status: "FINALIZED" },
      include: {
        customer: { include: { addresses: { orderBy: { recipientName: "asc" } } } },
        season: { select: { id: true, name: true, year: true } },
        lines: {
          orderBy: { id: "asc" },
          include: {
            product: { select: { id: true, kind: true } },
            productOption: true,
            recipientAddress: true,
            fulfillmentMethod: { select: { code: true } },
          },
        },
      },
    }),
    prisma.season.findUnique({
      where: { id: targetSeasonId },
      select: { id: true, name: true, year: true, status: true },
    }),
  ]);
  if (!sourceOrder) throw new Error("Only finalized orders can be repeated.");
  if (!targetSeason) throw new Error("The current repeat-order season was not found.");
  if (sourceOrder.seasonId === targetSeason.id) {
    throw new Error("Choose an order from an earlier season to repeat.");
  }

  const targetProducts = await prisma.product.findMany({
    where: { seasonId: targetSeason.id, isActive: true },
    orderBy: [{ priceCents: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      priceCents: true,
    },
  });
  const lines = await Promise.all(
    sourceOrder.lines.map(async (line) => {
      const mappedProductId = await resolveReplacementChain(
        prisma,
        line.productId,
        targetSeason.id,
      );
      const suggestions = targetProducts
        .filter((product) => product.kind === line.product.kind)
        .sort(
          (left, right) =>
            Math.abs(left.priceCents - line.unitPriceCentsSnapshot) -
              Math.abs(right.priceCents - line.unitPriceCentsSnapshot) ||
            left.name.localeCompare(right.name),
        );
      return {
        sourceLineId: line.id,
        sourceProductName: line.productNameSnapshot,
        sourcePriceCents: line.unitPriceCentsSnapshot,
        quantity: line.quantity,
        greeting: line.greetingSnapshot,
        recipientAddressId: line.recipientAddressId,
        recipientName:
          line.recipientAddress?.recipientName ??
          line.recipientNameSnapshot ??
          "Recipient missing",
        mappedProductId,
        suggestions,
      };
    }),
  );
  return {
    sourceOrder: {
      id: sourceOrder.id,
      version: sourceOrder.version,
      customerId: sourceOrder.customerId,
      customerName: sourceOrder.customer.displayName,
      season: sourceOrder.season,
    },
    targetSeason,
    addresses: sourceOrder.customer.addresses,
    lines,
  };
}

export async function createRepeatDraft(
  prisma: PrismaClient,
  input: {
    sourceOrderId: string;
    sourceVersion: number;
    actorStaffId?: string;
    decisions: RepeatLineDecision[];
  },
) {
  const targetSeasonId = await getRepeatTargetSeasonId(prisma);
  const review = await getRepeatReview(prisma, input.sourceOrderId, targetSeasonId);
  if (review.sourceOrder.version !== input.sourceVersion) {
    throw new Error("The source order changed. Reload the review before repeating it.");
  }
  const decisionsByLine = new Map(
    input.decisions.map((decision) => [decision.sourceLineId, decision]),
  );
  if (decisionsByLine.size !== review.lines.length) {
    throw new Error("Confirm a replacement or removal for every source line.");
  }
  const keptDecisions = review.lines.map((line) => {
    const decision = decisionsByLine.get(line.sourceLineId);
    if (!decision) throw new Error("Confirm every replacement and recipient.");
    if (!decision.productId) return { line, decision, productId: null };
    return { line, decision, productId: decision.productId };
  });
  if (!keptDecisions.some((entry) => entry.productId)) {
    throw new Error("Keep at least one gift in the repeated order.");
  }

  const productIds = keptDecisions.flatMap((entry) =>
    entry.productId ? [entry.productId] : [],
  );
  const addressIds = keptDecisions.flatMap((entry) =>
    entry.productId ? [entry.decision.recipientAddressId] : [],
  );
  const [source, products, addresses, targetMethods] = await Promise.all([
    prisma.order.findFirstOrThrow({
      where: {
        id: input.sourceOrderId,
        version: input.sourceVersion,
        status: "FINALIZED",
      },
      include: {
        lines: {
          include: {
            product: { select: { kind: true } },
            productOption: true,
            fulfillmentMethod: { select: { code: true } },
          },
        },
      },
    }),
    prisma.product.findMany({
      where: {
        id: { in: productIds },
        seasonId: targetSeasonId,
        isActive: true,
      },
      include: { options: { where: { isActive: true } } },
    }),
    prisma.customerAddress.findMany({
      where: {
        id: { in: addressIds },
        customerId: review.sourceOrder.customerId,
      },
    }),
    prisma.fulfillmentMethod.findMany({
      where: { seasonId: targetSeasonId, isActive: true },
    }),
  ]);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const addressesById = new Map(addresses.map((address) => [address.id, address]));
  const methodsByCode = new Map(targetMethods.map((method) => [method.code, method]));
  const sourceLinesById = new Map(source.lines.map((line) => [line.id, line]));

  const preparedLines = keptDecisions.flatMap(({ decision, productId, line }) => {
    if (!productId) return [];
    const product = productsById.get(productId);
    const address = addressesById.get(decision.recipientAddressId);
    const sourceLine = sourceLinesById.get(line.sourceLineId);
    if (!product || !address || !sourceLine) {
      throw new Error("A selected replacement or recipient is no longer available.");
    }
    if (product.kind !== sourceLine.product.kind) {
      throw new Error("A replacement must have the same catalog type.");
    }
    const option =
      product.options.find(
        (candidate) =>
          candidate.name === sourceLine.productOption?.name &&
          candidate.value === sourceLine.productOption?.value,
      ) ??
      product.options.find((candidate) => candidate.isDefault) ??
      null;
    const method = sourceLine.fulfillmentMethod
      ? methodsByCode.get(sourceLine.fulfillmentMethod.code)
      : null;
    return [{
      sourceLine,
      product,
      address,
      option,
      method,
      unitPriceCents: product.priceCents + (option?.priceAdjustmentCents ?? 0),
    }];
  });
  const subtotalCents = preparedLines.reduce(
    (total, entry) => total + entry.unitPriceCents * entry.sourceLine.quantity,
    0,
  );

  return prisma.$transaction(async (transaction) => {
    const draft = await transaction.order.create({
      data: {
        seasonId: targetSeasonId,
        customerId: source.customerId,
        draftReference: `R-${source.id.slice(-8)}-${randomBytes(4).toString("hex")}`,
        subtotalCents,
        totalCents: subtotalCents,
        defaultGreeting: source.defaultGreeting,
        lines: {
          create: preparedLines.map((entry) => ({
            productId: entry.product.id,
            productOptionId: entry.option?.id,
            recipientAddressId: entry.address.id,
            recipientSource: "ADDRESS_BOOK",
            recipientNameSnapshot: entry.address.recipientName,
            fulfillmentMethodId: entry.method?.id,
            greetingSnapshot: entry.sourceLine.greetingSnapshot,
            deliveryDay: entry.sourceLine.deliveryDay,
            productNameSnapshot: entry.product.name,
            skuSnapshot: entry.product.sku,
            unitPriceCentsSnapshot: entry.unitPriceCents,
            quantity: entry.sourceLine.quantity,
          })),
        },
      },
    });
    await transaction.auditLog.create({
      data: {
        actorStaffId: input.actorStaffId,
        action: "order.repeat_review_confirmed",
        targetType: "Order",
        targetId: draft.id,
        metadata: {
          sourceOrderId: source.id,
          sourceVersion: source.version,
          confirmedRecipients: preparedLines.length,
          removedLines: review.lines.length - preparedLines.length,
        },
      },
    });
    return draft;
  });
}

export async function repeatOrdersInBulk(
  prisma: PrismaClient,
  actorStaffId: string,
  requestedSources: { orderId: string; version: number }[],
) {
  if (requestedSources.length > MAX_REPEAT_BATCH) {
    throw new Error(`Bulk repeat accepts at most ${MAX_REPEAT_BATCH} orders.`);
  }
  const applied: { sourceOrderId: string; draftOrderId: string }[] = [];
  const conflicts: { orderId: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const requested of [...requestedSources].sort((left, right) =>
    left.orderId.localeCompare(right.orderId),
  )) {
    if (seen.has(requested.orderId)) {
      conflicts.push({ orderId: requested.orderId, reason: "duplicate request" });
      continue;
    }
    seen.add(requested.orderId);
    try {
      const review = await getRepeatReview(prisma, requested.orderId);
      if (
        review.lines.some(
          (line) => !line.mappedProductId || !line.recipientAddressId,
        )
      ) {
        throw new Error("replacement or recipient review is required");
      }
      const draft = await createRepeatDraft(prisma, {
        sourceOrderId: requested.orderId,
        sourceVersion: requested.version,
        actorStaffId,
        decisions: review.lines.map((line) => ({
          sourceLineId: line.sourceLineId,
          productId: line.mappedProductId,
          recipientAddressId: line.recipientAddressId!,
        })),
      });
      applied.push({ sourceOrderId: requested.orderId, draftOrderId: draft.id });
    } catch (error) {
      conflicts.push({
        orderId: requested.orderId,
        reason: error instanceof Error ? error.message : "repeat failed",
      });
    }
  }
  return { applied, conflicts };
}
