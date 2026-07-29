import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { readPayload } from "@/lib/imports/engine";
import { IMPORT_PERMISSION } from "@/lib/imports/kinds";
import { BackLink } from "@/components/admin/back-link";
import { ImportPreview } from "@/app/(admin)/admin/imports/[batchId]/import-preview";

const KIND_LABEL: Record<string, string> = {
  CUSTOMERS: "Customers",
  PRODUCTS: "Products",
  LEGACY_CUSTOMERS: "Legacy customers",
  LEGACY_PRODUCTS: "Legacy products",
  LEGACY_ORDERS: "Legacy orders",
};

export const metadata: Metadata = { title: "Import preview" };
export const dynamic = "force-dynamic";

// R-143: the preview gate — every row's verdict is visible before commit,
// and commit/discard are explicit staff decisions.
export default async function AdminImportPreviewPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) notFound();

  const ctx = await requireStaff();
  if (!hasPermission(ctx.staff, IMPORT_PERMISSION[batch.kind])) forbidden();

  const payload = readPayload(batch);

  return (
    <div>
      <BackLink href="/admin/imports" label="Imports" />
      <h1 className="mt-3 text-2xl font-semibold" data-import-heading>
        {batch.filename}
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        {KIND_LABEL[batch.kind] ?? batch.kind} import · staged {batch.createdAt.toISOString().slice(0, 16).replace("T", " ")}
        {batch.actorEmail ? ` by ${batch.actorEmail}` : ""}
        {batch.dryRun ? " · DRY RUN — validated only, can never commit" : ""}
      </p>

      <ImportPreview
        batchId={batch.id}
        status={batch.status}
        dryRun={batch.dryRun}
        counts={{
          total: batch.totalRows,
          valid: batch.validRows,
          duplicate: batch.duplicateRows,
          invalid: batch.invalidRows,
          committed: batch.committedRows,
        }}
        rows={payload.rows.map((row) => ({
          row: row.row,
          verdict: row.verdict,
          reason: row.reason ?? null,
          // Missing values stay null — the preview owns the "—" sentinel.
          data: Object.fromEntries(
            Object.entries(row.data).map(([key, value]) => [key, value === null ? null : String(value)]),
          ),
        }))}
      />
    </div>
  );
}
