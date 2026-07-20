import { forbidden } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current-user";
import { ImportClient } from "@/components/admin/import-client";

/** Staged CSV import for customers and products (R-063, R-143). */
export default async function AdminImportPage() {
  const staff = await getStaffContext();
  const canCustomers = staff?.actingAs.permissions.has("customers.manage") ?? false;
  const canProducts = staff?.actingAs.permissions.has("catalog.manage") ?? false;
  if (!canCustomers && !canProducts) forbidden();

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">CSV import</h1>
      <p className="text-sm text-muted mb-4">
        Stage a file, review every row, then commit. Commits are all-or-nothing: one invalid row
        blocks the whole import, duplicates are skipped and reported, and every commit is audited.
      </p>
      <ImportClient canCustomers={canCustomers} canProducts={canProducts} />
    </div>
  );
}
