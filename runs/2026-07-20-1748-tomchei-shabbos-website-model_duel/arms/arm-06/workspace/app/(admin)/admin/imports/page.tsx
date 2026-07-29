import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { forbidden } from "next/navigation";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { ImportUpload } from "@/app/(admin)/admin/imports/import-upload";

export const metadata: Metadata = { title: "Imports" };
export const dynamic = "force-dynamic";

// R-063: CSV import home — stage a file, review recent batches. The kinds a
// staff user sees follow their permissions (customers vs catalog).
export default async function AdminImportsPage() {
  const ctx = await requireStaff();
  const canCustomers = hasPermission(ctx.staff, "customers.manage");
  const canCatalog = hasPermission(ctx.staff, "catalog.manage");
  if (!canCustomers && !canCatalog) forbidden();

  const batches = await prisma.importBatch.findMany({
    // A customers-only staffer sees CUSTOMERS batches, catalog-only sees
    // PRODUCTS, both see everything — batch metadata never crosses permission.
    where: canCustomers && canCatalog ? {} : canCustomers ? { kind: "CUSTOMERS" } : { kind: "PRODUCTS" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Imports</h1>
      <p className="mt-1 text-sm text-stone-500">
        Staged CSV imports — preview every row&apos;s verdict before anything writes.
      </p>

      <ImportUpload canCustomers={canCustomers} canCatalog={canCatalog} />

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Recent batches</h2>
        <ul className="mt-3 flex flex-col gap-2" data-import-batches>
          {batches.map((batch) => (
            <li key={batch.id}>
              <Link
                href={`/admin/imports/${batch.id}`}
                className="flex flex-wrap items-center gap-3 rounded-md border border-stone-200 bg-white px-4 py-2.5 text-sm hover:border-brand-300"
              >
                <Badge tone={batch.status === "COMMITTED" ? "green" : batch.status === "DISCARDED" ? "stone" : "amber"}>
                  {batch.status}
                </Badge>
                <span className="font-medium text-stone-900">{batch.filename}</span>
                <span className="text-stone-600">{batch.kind === "CUSTOMERS" ? "Customers" : "Products"}</span>
                <span className="text-stone-500">
                  {batch.validRows} valid · {batch.duplicateRows} dup · {batch.invalidRows} invalid
                  {batch.status === "COMMITTED" ? ` · ${batch.committedRows} committed` : ""}
                </span>
                <span className="ml-auto text-xs text-stone-500">{batch.createdAt.toISOString().slice(0, 10)}</span>
              </Link>
            </li>
          ))}
          {batches.length === 0 && <li className="text-sm text-stone-500">No imports yet.</li>}
        </ul>
      </section>
    </div>
  );
}
