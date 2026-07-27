import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type RepeatLine = {
  sourceLineId: string;
  sourceProductId: string;
  sourceName: string;
  sourcePriceCents: number;
  quantity: number;
  recipient: { addressId?: string; recipientName: string; greeting: string };
  candidates: Array<{ id: string; name: string; priceCents: number }>;
  suggestedProductId?: string;
};

function draftReference() {
  return `REPEAT-${randomBytes(8).toString("hex").toUpperCase()}`;
}

async function replacementCandidates(sourceProductId: string, targetSeasonId: string, sourcePriceCents: number) {
  const visited = new Set([sourceProductId]);
  let frontier = [sourceProductId];
  const candidates = new Map<string, { id: string; name: string; priceCents: number }>();

  while (frontier.length > 0) {
    const mappings = await prisma.productReplacement.findMany({
      where: { sourceProductId: { in: frontier } },
      include: { targetProduct: true },
    });
    frontier = [];
    for (const mapping of mappings) {
      const target = mapping.targetProduct;
      if (target.seasonId === targetSeasonId && target.isActive) {
        candidates.set(target.id, { id: target.id, name: target.name, priceCents: target.priceCents });
      }
      if (!visited.has(target.id)) {
        visited.add(target.id);
        frontier.push(target.id);
      }
    }
  }

  return [...candidates.values()].sort((left, right) =>
    Math.abs(left.priceCents - sourcePriceCents) - Math.abs(right.priceCents - sourcePriceCents)
    || left.name.localeCompare(right.name));
}

export async function resolveReplacementChain(sourceProductId: string, targetSeasonId: string) {
  const source = await prisma.product.findUniqueOrThrow({ where: { id: sourceProductId } });
  if (source.seasonId === targetSeasonId && source.isActive) {
    return [{ id: source.id, name: source.name, priceCents: source.priceCents }];
  }
  return replacementCandidates(sourceProductId, targetSeasonId, source.priceCents);
}

export async function createRepeatDraft(sourceOrderId: string, targetSeasonId: string, expectedCustomerId?: string) {
  const sourceOrder = await prisma.order.findFirst({
    where: { id: sourceOrderId, status: "FINALIZED", ...(expectedCustomerId ? { customerId: expectedCustomerId } : {}) },
    include: {
      lines: {
        include: {
          product: true,
          packageLines: { include: { package: { include: { address: true } } } },
        },
      },
    },
  });
  if (!sourceOrder?.customerId) throw new Error("Choose a finalized prior order that belongs to this customer.");
  const targetSeason = await prisma.season.findUnique({ where: { id: targetSeasonId } });
  if (!targetSeason?.status || targetSeason.status !== "OPEN") throw new Error("Choose an open season for the repeat order.");

  const lines = (await Promise.all(sourceOrder.lines.map(async (sourceLine) => {
    const candidates = await resolveReplacementChain(sourceLine.productId, targetSeasonId);
    const packageLines = sourceLine.packageLines.length > 0 ? sourceLine.packageLines : [undefined];
    return packageLines.map((packageLine) => {
      const packageRecord = packageLine?.package;
      return {
        sourceLineId: packageLine ? `${sourceLine.id}:${packageLine.id}` : sourceLine.id,
        sourceProductId: sourceLine.productId,
        sourceName: sourceLine.productNameSnapshot,
        sourcePriceCents: sourceLine.unitPriceCents,
        quantity: packageLine?.quantity ?? sourceLine.quantity,
        recipient: {
          addressId: packageRecord?.addressId ?? undefined,
          recipientName: packageRecord?.recipientName ?? "Choose a recipient",
          greeting: packageRecord?.greeting ?? "",
        },
        candidates,
        suggestedProductId: candidates[0]?.id,
      };
    });
  }))).flat();

  return prisma.order.create({
    data: {
      seasonId: targetSeasonId,
      customerId: sourceOrder.customerId,
      draftReference: draftReference(),
      wireFormat: { version: 3, repeat: { sourceOrderId, lines } },
    },
  });
}

export async function readRepeatDraft(draftId: string, customerId?: string) {
  const draft = await prisma.order.findFirst({
    where: { id: draftId, status: "DRAFT", ...(customerId ? { customerId } : {}) },
    include: { season: true, customer: { include: { addresses: true } } },
  });
  if (!draft) return null;
  const repeat = (draft.wireFormat as { repeat?: { sourceOrderId: string; lines: RepeatLine[] } }).repeat;
  if (!repeat) return null;
  return { draft, repeat };
}

type ConfirmedRepeatLine = {
  sourceLineId: string;
  productId?: string;
  addressId?: string;
  greeting: string;
};

export async function confirmRepeatDraft(draftId: string, selectedLines: ConfirmedRepeatLine[], customerId?: string) {
  const repeatDraft = await readRepeatDraft(draftId, customerId);
  if (!repeatDraft) throw new Error("That repeat draft was not found.");
  const sourceLines = new Map(repeatDraft.repeat.lines.map((line) => [line.sourceLineId, line]));
  if (selectedLines.length !== sourceLines.size) throw new Error("Review every prior item before continuing.");

  const persistedLines: Array<{ productId: string; quantity: number; addressId: string; greeting: string }> = [];
  for (const selectedLine of selectedLines) {
    const sourceLine = sourceLines.get(selectedLine.sourceLineId);
    if (!sourceLine) throw new Error("The repeat review contains an unknown item.");
    if (!selectedLine.productId) continue;
    if (!sourceLine.candidates.some((candidate) => candidate.id === selectedLine.productId)) {
      throw new Error(`Choose a mapped replacement for ${sourceLine.sourceName} or remove it.`);
    }
    const addressId = selectedLine.addressId ?? sourceLine.recipient.addressId;
    if (!addressId) throw new Error(`Choose a recipient for ${sourceLine.sourceName}.`);
    persistedLines.push({ productId: selectedLine.productId, quantity: sourceLine.quantity, addressId, greeting: selectedLine.greeting.trim() });
  }
  if (persistedLines.length === 0) throw new Error("Keep at least one item in the repeated order.");

  const products = await prisma.product.findMany({ where: { id: { in: persistedLines.map((line) => line.productId) }, seasonId: repeatDraft.draft.seasonId, isActive: true } });
  if (products.length !== new Set(persistedLines.map((line) => line.productId)).size) throw new Error("A selected replacement is no longer available.");
  const draftCustomerId = repeatDraft.draft.customerId;
  if (!draftCustomerId) throw new Error("Repeat drafts must belong to a customer.");
  const addressCount = await prisma.address.count({
    where: { id: { in: persistedLines.map((line) => line.addressId) }, customerId: draftCustomerId },
  });
  if (addressCount !== new Set(persistedLines.map((line) => line.addressId)).size) throw new Error("Choose recipients from this customer's address book.");

  const preparedLines = persistedLines.map((line) => {
    const product = products.find((candidate) => candidate.id === line.productId)!;
    return { ...line, product };
  });
  const subtotalCents = preparedLines.reduce((total, line) => total + line.product.priceCents * line.quantity, 0);
  await prisma.$transaction(async (transaction) => {
    await transaction.orderLine.deleteMany({ where: { orderId: draftId } });
    await transaction.order.update({
      where: { id: draftId },
      data: {
        subtotalCents,
        totalCents: subtotalCents,
        wireFormat: {
          version: 3,
          lines: preparedLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            addOns: [],
            recipient: { kind: "saved", addressId: line.addressId },
            greeting: line.greeting,
          })),
          repeat: { sourceOrderId: repeatDraft.repeat.sourceOrderId, confirmedAt: new Date().toISOString() },
        } as Prisma.InputJsonValue,
        lines: {
          create: preparedLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            productNameSnapshot: line.product.name,
            skuSnapshot: line.product.sku,
            unitPriceCents: line.product.priceCents,
          })),
        },
      },
    });
  });
  return draftId;
}
