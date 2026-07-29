import { FulfillmentChoice, Prisma, PrintBatch, PrintBatchTrigger } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { getOpenSeason } from "@/lib/seasons/queries";
import { loadTerminalStages, PackageEventAction } from "@/lib/packages/stages";

// UR-005: the nightly print batch. Every non-terminal package not yet claimed
// by any batch is filed into ONE new batch per filing group, so re-running is
// idempotent by construction (nothing unclaimed → nothing created). Reprints
// create a new batch that supersedes the predecessor — batch membership is
// never mutated, so a printed stack always matches what was filed.
//
// Filing-group key (merged plan open question #2, decided for this build):
// the fulfillment channel. Sort inside a group: recipient name, then order
// number — the two facts a filing volunteer actually looks at.
export function filingGroupForChannel(channel: FulfillmentChoice): string {
  return channel;
}

const claimedSelect = {
  id: true,
  channel: true,
  recipientName: true,
  orderId: true,
  order: { select: { orderNumber: true } },
} satisfies Prisma.PackageSelect;

// Filing order: recipient name, then order number, package id as tiebreaker —
// the same batch always produces the same report, row for row. Shared with
// the PDF render path so page order matches the persisted PrintBatchItem order.
export function sortForFiling<T extends { id: string; recipientName: string; orderNumber: number | null }>(
  packages: T[],
): T[] {
  return [...packages].sort(
    (a, b) =>
      a.recipientName.localeCompare(b.recipientName) ||
      (a.orderNumber ?? 0) - (b.orderNumber ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

type ClaimedPackage = Prisma.PackageGetPayload<{ select: typeof claimedSelect }> & { orderNumber: number | null };

async function writePrintEvents(
  tx: Prisma.TransactionClient,
  packageIds: string[],
  batchId: string,
  trigger: PrintBatchTrigger,
): Promise<void> {
  const action: PackageEventAction = "print";
  await tx.packageEvent.createMany({
    data: packageIds.map((packageId) => ({ packageId, action, metadata: { batchId, trigger } })),
  });
}

export interface CreatedBatch {
  id: string;
  filingGroup: string;
  packageCount: number;
}

export interface NightlyRunResult {
  batches: CreatedBatch[];
  packageCount: number;
  cronRunId: string;
}

// Claims every unbatched non-terminal package in the open season. The
// advisory lock serializes overlapping runs (cron + staff "run now"), so a
// second runner always sees the first runner's committed membership and files
// nothing. A CronRun row lands either way (R-163).
export async function runNightlyPrintBatch(input: { createdById?: string } = {}): Promise<NightlyRunResult> {
  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError("No open season — the nightly print batch only files the open season's packages");
  const terminalStages = await loadTerminalStages();

  const cronRun = await prisma.cronRun.create({ data: { name: "nightly-print" } });
  try {
    const result = await prisma.$transaction(async (tx) => {
      // $executeRaw: the lock returns void, which $queryRaw cannot deserialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nightly-print'))`;
      const claimed: ClaimedPackage[] = (await tx.package.findMany({
        where: {
          order: { seasonId: season.id },
          stage: { notIn: terminalStages },
          batchItems: { none: {} },
        },
        select: claimedSelect,
      })).map((pkg) => ({ ...pkg, orderNumber: pkg.order.orderNumber }));

      const byGroup = new Map<string, ClaimedPackage[]>();
      for (const pkg of claimed) {
        const group = filingGroupForChannel(pkg.channel);
        byGroup.set(group, [...(byGroup.get(group) ?? []), pkg]);
      }

      const batches: CreatedBatch[] = [];
      for (const [filingGroup, packages] of [...byGroup.entries()].sort()) {
        const sorted = sortForFiling(packages);
        const batch = await tx.printBatch.create({
          data: {
            seasonId: season.id,
            filingGroup,
            trigger: "NIGHTLY",
            packageCount: sorted.length,
            createdById: input.createdById ?? null,
          },
        });
        await tx.printBatchItem.createMany({
          data: sorted.map((pkg) => ({ batchId: batch.id, packageId: pkg.id, orderId: pkg.orderId })),
        });
        await writePrintEvents(tx, sorted.map((pkg) => pkg.id), batch.id, "NIGHTLY");
        batches.push({ id: batch.id, filingGroup, packageCount: sorted.length });
      }
      return { batches, packageCount: claimed.length };
    });

    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: {
        status: "OK",
        finishedAt: new Date(),
        message: `${result.packageCount} package(s) filed into ${result.batches.length} batch(es)`,
      },
    });
    return { ...result, cronRunId: cronRun.id };
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "FAILED", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

// Reprint one filing group OR one order (XOR): a fresh batch over that
// scope's current non-terminal packages, superseding the latest batch IN THE
// SAME scope (an order reprint never supersedes a nightly multi-order batch).
// Unrelated groups are never regenerated. Snapshot and create share the
// nightly advisory lock so a concurrent run can't file a stale package set or
// fork the supersession chain.
export async function reprintBatch(input: {
  filingGroup?: string;
  orderId?: string;
  createdById?: string;
}): Promise<PrintBatch> {
  if ((input.filingGroup ? 1 : 0) + (input.orderId ? 1 : 0) !== 1) {
    throw new DomainRuleError("Reprint takes exactly one scope: a filing group or an order id");
  }

  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError("No open season — reprints only act on the open season's packages");
  const terminalStages = await loadTerminalStages();

  const filingGroup = input.filingGroup ?? `ORDER:${input.orderId}`;
  const trigger: PrintBatchTrigger = input.filingGroup ? "REPRINT_GROUP" : "REPRINT_ORDER";

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nightly-print'))`;
    const packages: ClaimedPackage[] = (await tx.package.findMany({
      where: {
        order: { seasonId: season.id },
        stage: { notIn: terminalStages },
        ...(input.orderId ? { orderId: input.orderId } : {}),
      },
      select: claimedSelect,
    })).map((pkg) => ({ ...pkg, orderNumber: pkg.order.orderNumber }));
    const scoped = input.filingGroup ? packages.filter((pkg) => filingGroupForChannel(pkg.channel) === input.filingGroup) : packages;
    if (scoped.length === 0) {
      throw new NotFoundError("Reprintable packages", input.filingGroup ?? input.orderId ?? "");
    }

    const predecessor = await tx.printBatch.findFirst({
      where: { seasonId: season.id, filingGroup },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const sorted = sortForFiling(scoped);
    const batch = await tx.printBatch.create({
      data: {
        seasonId: season.id,
        filingGroup,
        trigger,
        supersedesId: predecessor?.id ?? null,
        packageCount: sorted.length,
        createdById: input.createdById ?? null,
      },
    });
    await tx.printBatchItem.createMany({
      data: sorted.map((pkg) => ({ batchId: batch.id, packageId: pkg.id, orderId: pkg.orderId })),
    });
    await writePrintEvents(tx, sorted.map((pkg) => pkg.id), batch.id, trigger);
    return batch;
  });
}
