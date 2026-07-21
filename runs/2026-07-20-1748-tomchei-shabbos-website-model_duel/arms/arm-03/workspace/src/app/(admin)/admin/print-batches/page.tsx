import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { PrintBatchesClient } from "@/components/admin/print-batches";

export default async function PrintBatchesPage() {
  try {
    await requireAdminPage("admin.access");
    return (
      <main className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Print batches
        </h1>
        <p className="text-sm opacity-70">
          Nightly PDFs per filing group (slips, labels, greeting cards) plus per-order packing slips.
        </p>
        <PrintBatchesClient />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
