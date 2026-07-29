import type { Metadata } from "next";
import { PackageStage } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { getOpenSeason } from "@/lib/seasons/queries";
import { CHANNEL_LABELS, formatBatchTimestamp, loadFulfillmentSummary } from "@/lib/packages/fulfillment";
import { loadTerminalStages } from "@/lib/packages/stages";
import { Card, CardTitle } from "@/components/ui/card";
import { PackageStageBadge } from "@/components/admin/order-badges";
import { FulfillmentActions } from "@/app/(admin)/admin/fulfillment/fulfillment-actions";

export const metadata: Metadata = { title: "Fulfillment" };
export const dynamic = "force-dynamic";

// Per-channel bulk tables stay bounded regardless of crunch size (G-024).
const BULK_TABLE_LIMIT = 50;
const RECENT_BATCHES_LIMIT = 10;

// R-072/R-073: the fulfillment channel dashboard — per-channel stage counts,
// production buckets, bulk-consolidation savings, bulk stage advance, and the
// nightly print batch with reprints. Print batches never move package stages
// (G-004); the "awaiting batch" count is tonight's filing work.
export default async function AdminFulfillmentPage() {
  await requirePermission("fulfillment.manage");
  const openSeason = await getOpenSeason();

  if (!openSeason) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Fulfillment</h1>
        <p className="mt-4 text-sm text-stone-600">No open season.</p>
      </div>
    );
  }

  const terminalStages = await loadTerminalStages();
  const [summary, bulkPackages, recentBatches] = await Promise.all([
    loadFulfillmentSummary(openSeason.id),
    prisma.package.findMany({
      where: { order: { seasonId: openSeason.id }, stage: { notIn: terminalStages } },
      orderBy: [{ channel: "asc" }, { recipientName: "asc" }, { id: "asc" }],
      take: BULK_TABLE_LIMIT * 3,
      select: { id: true, recipientName: true, stage: true, channel: true },
    }),
    prisma.printBatch.findMany({
      where: { seasonId: openSeason.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_BATCHES_LIMIT,
      select: { id: true, filingGroup: true, trigger: true, packageCount: true, createdAt: true },
    }),
  ]);

  const packagesByChannel = new Map<string, typeof bulkPackages>();
  for (const pkg of bulkPackages) {
    const list = packagesByChannel.get(pkg.channel) ?? [];
    if (list.length < BULK_TABLE_LIMIT) list.push(pkg);
    packagesByChannel.set(pkg.channel, list);
  }

  return (
    <div data-fulfillment-dashboard>
      <h1 className="text-2xl font-semibold">Fulfillment — {openSeason.name}</h1>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {summary.channels.map((channel) => (
          <Card key={channel.channel} className="p-4" data-channel-card={channel.channel}>
            <CardTitle>{channel.label}</CardTitle>
            <p className="mt-2 text-2xl font-semibold">{channel.total}</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-stone-600">
              {Object.entries(channel.stageCounts).map(([stage, count]) => (
                <li key={stage} className="flex items-center justify-between">
                  <PackageStageBadge stage={stage as PackageStage} />
                  <span>{count}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-stone-500" data-awaiting-batch={channel.channel}>
              {channel.awaitingBatch} awaiting tonight&apos;s batch
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="p-4" data-production-summary>
          <CardTitle>Production</CardTitle>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            <li className="flex justify-between">
              <span>To print</span>
              <span className="font-medium" data-to-print>{summary.production.toPrint}</span>
            </li>
            <li className="flex justify-between">
              <span>To pack</span>
              <span className="font-medium" data-to-pack>{summary.production.toPack}</span>
            </li>
            <li className="flex justify-between">
              <span>To send / hand out</span>
              <span className="font-medium" data-to-send>{summary.production.toSend}</span>
            </li>
          </ul>
        </Card>
        <Card className="p-4" data-bulk-savings>
          <CardTitle>Bulk consolidation savings</CardTitle>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            <li className="flex justify-between">
              <span>Destinations</span>
              <span className="font-medium">{summary.bulkSavings.destinations}</span>
            </li>
            <li className="flex justify-between">
              <span>Recipients consolidated</span>
              <span className="font-medium">{summary.bulkSavings.recipients}</span>
            </li>
            <li className="flex justify-between">
              <span>Destination fees collected</span>
              <span className="font-medium">{formatCents(summary.bulkSavings.feesCollectedCents)}</span>
            </li>
            <li className="flex justify-between">
              <span>Fees avoided by consolidation</span>
              <span className="font-medium text-green-800" data-saved-cents>
                {formatCents(summary.bulkSavings.savedCents)}
              </span>
            </li>
          </ul>
        </Card>
      </div>

      <FulfillmentActions
        channels={summary.channels.map((channel) => ({
          channel: channel.channel,
          label: channel.label,
          packages: (packagesByChannel.get(channel.channel) ?? []).map((pkg) => ({
            id: pkg.id,
            recipientName: pkg.recipientName,
            stage: pkg.stage,
          })),
        }))}
        filingGroups={Object.entries(CHANNEL_LABELS).map(([key, label]) => ({ key, label }))}
      />

      <Card className="mt-4 p-4">
        <CardTitle>Recent print batches</CardTitle>
        <ul className="mt-2 flex flex-col gap-2 text-sm" data-batch-list>
          {recentBatches.map((batch) => (
            <li key={batch.id} className="flex flex-wrap items-center justify-between gap-2" data-batch-row={batch.id}>
              <span>
                <span className="font-medium">{batch.filingGroup}</span> — {batch.trigger.toLowerCase().replaceAll("_", " ")},{" "}
                {batch.packageCount} package(s), {formatBatchTimestamp(batch.createdAt)}
              </span>
              <span className="flex gap-2 text-xs">
                {(["slips", "labels", "cards"] as const).map((artifact) => (
                  <a
                    key={artifact}
                    href={`/api/admin/fulfillment/print-batches/${batch.id}/pdf?artifact=${artifact}`}
                    className="font-medium text-brand-700 hover:underline"
                    data-batch-pdf={artifact}
                  >
                    {artifact} PDF
                  </a>
                ))}
              </span>
            </li>
          ))}
          {recentBatches.length === 0 && <li className="text-stone-500">No print batches yet — run the nightly batch.</li>}
        </ul>
      </Card>
    </div>
  );
}
