import { ImportManager } from "@/components/import-manager";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  await requirePermission("settings:manage");
  const batches = await db.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Data intake</p>
      <h1 className="mt-2 text-4xl font-black">CSV imports</h1>
      <p className="mt-3 max-w-2xl text-[var(--muted)]">
        Stage and inspect up to 2,000 customer or product rows. Any error blocks the entire commit.
      </p>
      <ImportManager
        initialBatches={batches.map((batch) => ({
          id: batch.id,
          entityType: batch.entityType,
          status: batch.status,
          sourceName: batch.sourceName,
          validRowCount: batch.validRowCount,
          invalidRowCount: batch.invalidRowCount,
          duplicateCount: batch.duplicateCount,
          errors: Array.isArray(batch.errors)
            ? batch.errors.filter(
                (issue): issue is { rowNumber: number; code: string; message: string } =>
                  typeof issue === "object" &&
                  issue !== null &&
                  !Array.isArray(issue) &&
                  "rowNumber" in issue &&
                  "code" in issue &&
                  "message" in issue &&
                  typeof issue.rowNumber === "number" &&
                  typeof issue.code === "string" &&
                  typeof issue.message === "string",
              )
            : [],
        }))}
      />
    </div>
  );
}
