import { FulfillmentChoice, PackageStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bulkAddressKey } from "@/lib/checkout/fulfillment";
import { parseMethodStages } from "@/lib/packages/stages";

// R-072/R-073: fulfillment channel dashboard read model. Channels are the
// three checkout fulfillment flavors; production buckets respect each
// method's stage list (pickup never lands in "to print" — it skips PRINTED).
export const CHANNEL_LABELS: Record<FulfillmentChoice, string> = {
  PICKUP: "Pickup",
  BULK_DELIVERY: "Bulk delivery",
  PER_PACKAGE_DELIVERY: "Per-package delivery",
  SHIPPED: "Carrier shipping",
};

export interface ChannelSummary {
  channel: FulfillmentChoice;
  label: string;
  stageCounts: Partial<Record<PackageStage, number>>;
  total: number;
  // Non-terminal packages not yet claimed by any print batch — tonight's work.
  awaitingBatch: number;
}

export interface ProductionSummary {
  toPrint: number;
  toPack: number;
  toSend: number;
}

export interface BulkSavingsSummary {
  destinations: number;
  recipients: number;
  feesCollectedCents: number;
  // Destination fees avoided by consolidation: (recipients - 1) x the paid
  // per-destination fee, per destination, summed. Pure snapshot math — no
  // dependency on the current fee settings.
  savedCents: number;
}

export interface FulfillmentSummary {
  channels: ChannelSummary[];
  production: ProductionSummary;
  bulkSavings: BulkSavingsSummary;
}

// Batch/event timestamps render one way everywhere: "YYYY-MM-DD HH:MM" UTC.
export function formatBatchTimestamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export async function loadFulfillmentSummary(seasonId: string): Promise<FulfillmentSummary> {
  const [packages, methods, batchedPackageIds, bulkRecipients] = await Promise.all([
    prisma.package.findMany({
      where: { order: { seasonId } },
      select: { id: true, channel: true, stage: true, fulfillmentMethodId: true },
    }),
    prisma.fulfillmentMethod.findMany({ select: { id: true, code: true, stages: true, terminalStage: true } }),
    prisma.printBatchItem.findMany({
      where: { batch: { seasonId } },
      select: { packageId: true },
      distinct: ["packageId"],
    }),
    prisma.draftRecipient.findMany({
      where: { order: { seasonId, status: "FINALIZED" }, fulfillmentChoice: "BULK_DELIVERY" },
      select: { line1: true, city: true, region: true, postalCode: true, country: true, deliveryFeeCents: true },
    }),
  ]);

  const batched = new Set(batchedPackageIds.map((batchItem) => batchItem.packageId));
  const methodStages = new Map(
    methods.map((method) => [method.id, parseMethodStages(method.stages, method.code)]),
  );
  // Terminal truth lives on the methods, never in a hardcoded stage list.
  const terminalStages = new Set(methods.map((method) => method.terminalStage));

  const channelMap = new Map<FulfillmentChoice, ChannelSummary>();
  for (const channel of Object.values(FulfillmentChoice)) {
    channelMap.set(channel, {
      channel,
      label: CHANNEL_LABELS[channel],
      stageCounts: {},
      total: 0,
      awaitingBatch: 0,
    });
  }

  const production: ProductionSummary = { toPrint: 0, toPack: 0, toSend: 0 };
  for (const pkg of packages) {
    const summary = channelMap.get(pkg.channel)!;
    summary.total += 1;
    summary.stageCounts[pkg.stage] = (summary.stageCounts[pkg.stage] ?? 0) + 1;
    if (!batched.has(pkg.id) && !terminalStages.has(pkg.stage)) {
      summary.awaitingBatch += 1;
    }
    const stages = methodStages.get(pkg.fulfillmentMethodId)!;
    const methodPrints = stages.includes("PRINTED");
    // "To print" is tonight's backlog: a package already claimed by a batch
    // has been sent to print even though its stage stays NEW by design.
    if (pkg.stage === "NEW" && methodPrints) {
      if (!batched.has(pkg.id)) production.toPrint += 1;
    } else if (pkg.stage === "PRINTED" || (pkg.stage === "NEW" && !methodPrints)) production.toPack += 1;
    else if (pkg.stage === "PACKED") production.toSend += 1;
  }

  const destinations = new Map<string, { recipients: number; feeCents: number }>();
  for (const recipient of bulkRecipients) {
    const key = bulkAddressKey(recipient);
    const group = destinations.get(key) ?? { recipients: 0, feeCents: 0 };
    group.recipients += 1;
    group.feeCents = Math.max(group.feeCents, recipient.deliveryFeeCents);
    destinations.set(key, group);
  }
  const bulkSavings: BulkSavingsSummary = { destinations: destinations.size, recipients: bulkRecipients.length, feesCollectedCents: 0, savedCents: 0 };
  for (const group of destinations.values()) {
    bulkSavings.feesCollectedCents += group.feeCents;
    bulkSavings.savedCents += (group.recipients - 1) * group.feeCents;
  }

  return { channels: [...channelMap.values()], production, bulkSavings };
}
