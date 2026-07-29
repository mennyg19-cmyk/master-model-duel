import { PackageStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike } from "@/lib/audit";
import { getOpenSeason } from "@/lib/seasons/queries";
import { advancePackageStage, IllegalStageTransitionError, PackageConcurrencyError } from "@/lib/packages/stages";
import { BULK_ACTION_LIMIT } from "@/lib/orders/bulk";

// R-072: bulk status advance from the fulfillment dashboard — same bounded,
// deterministic discipline as order bulk actions (G-024): at most
// BULK_ACTION_LIMIT ids, sequential in input order, per-row skip reasons, and
// one audit row carrying the full report (written by the route).
export interface BulkAdvanceItemResult {
  packageId: string;
  outcome: "advanced" | "skipped";
  reason?: string;
}

export interface BulkAdvanceReport {
  action: "advance";
  to: PackageStage;
  results: BulkAdvanceItemResult[];
  counts: { succeeded: number; skipped: number };
}

export async function runBulkPackageAdvance(input: {
  packageIds: string[];
  to: PackageStage;
  ctx: AuditContextLike;
}): Promise<BulkAdvanceReport> {
  if (input.packageIds.length > BULK_ACTION_LIMIT) {
    throw new DomainRuleError(
      `Bulk actions take at most ${BULK_ACTION_LIMIT} packages per call; got ${input.packageIds.length}`,
    );
  }

  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError("No open season — bulk actions only act on the open season's packages");
  const candidateIds = [...new Set(input.packageIds.map((id) => id.trim()).filter((id) => id !== ""))];
  const scoped = await prisma.package.findMany({
    where: { id: { in: candidateIds }, order: { seasonId: season.id } },
    select: { id: true, version: true },
  });
  const versionById = new Map(scoped.map((pkg) => [pkg.id, pkg.version]));

  const results: BulkAdvanceItemResult[] = [];
  const seen = new Set<string>();
  for (const raw of input.packageIds) {
    const packageId = raw.trim();
    if (!packageId) continue;
    if (seen.has(packageId)) {
      results.push({ packageId, outcome: "skipped", reason: "duplicate in batch — first occurrence already processed" });
      continue;
    }
    seen.add(packageId);
    const version = versionById.get(packageId);
    if (version === undefined) {
      results.push({ packageId, outcome: "skipped", reason: "not a package in the open season" });
      continue;
    }
    try {
      await advancePackageStage({ packageId, expectedVersion: version, to: input.to, actorId: input.ctx.staff.id });
      results.push({ packageId, outcome: "advanced" });
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof DomainRuleError ||
        error instanceof IllegalStageTransitionError ||
        error instanceof PackageConcurrencyError
      ) {
        results.push({ packageId, outcome: "skipped", reason: error.message });
      } else {
        throw error;
      }
    }
  }

  return {
    action: "advance",
    to: input.to,
    results,
    counts: {
      succeeded: results.filter((entry) => entry.outcome === "advanced").length,
      skipped: results.filter((entry) => entry.outcome === "skipped").length,
    },
  };
}
