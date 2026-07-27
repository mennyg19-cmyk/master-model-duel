import { forbidden } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { ImportClient } from "@/components/admin/import-client";
import { LegacyImportClient } from "@/components/admin/legacy-import-client";

/** Staged CSV import (R-063, R-143) + the legacy migration pipeline (P12). */
export default async function AdminImportPage() {
  const staff = await getStaffContext();
  const canCustomers = staff?.actingAs.permissions.has("customers.manage") ?? false;
  const canProducts = staff?.actingAs.permissions.has("catalog.manage") ?? false;
  const canLegacy = staff?.actingAs.permissions.has("imports.legacy") ?? false;
  if (!canCustomers && !canProducts && !canLegacy) forbidden();

  const [runs, reviewItems] = canLegacy
    ? await Promise.all([
        db.legacyImportRun.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { stages: { orderBy: { finishedAt: "asc" } } },
        }),
        db.addressReviewItem.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" }, take: 100 }),
      ])
    : [[], []];

  return (
    <div className="space-y-8">
      {(canCustomers || canProducts) && (
        <div>
          <h1 className="text-2xl font-semibold mb-1">CSV import</h1>
          <p className="text-sm text-muted mb-4">
            Stage a file, review every row, then commit. Commits are all-or-nothing: one invalid row
            blocks the whole import, duplicates are skipped and reported, and every commit is audited.
          </p>
          <ImportClient canCustomers={canCustomers} canProducts={canProducts} />
        </div>
      )}
      {canLegacy && (
        <LegacyImportClient
          runs={runs.map((run) => ({
            id: run.id,
            fileName: run.fileName,
            status: run.status,
            createdAt: run.createdAt.toISOString(),
            stages: run.stages.map((stage) => ({ stage: stage.stage, finishedAt: stage.finishedAt.toISOString() })),
          }))}
          reviewItems={reviewItems.map((item) => ({
            id: item.id,
            reason: item.reason,
            detail: (item.detail ?? null) as Record<string, unknown> | null,
          }))}
        />
      )}
    </div>
  );
}
