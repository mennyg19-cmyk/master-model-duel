import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { ReportsClient } from "@/components/admin/reports-client";

export default async function AdminReportsPage() {
  try {
    await requireAdminPage("admin.access");
    return (
      <main className="space-y-4" data-testid="admin-reports">
        <header className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Reports
          </h1>
          <p className="mt-1 text-sm opacity-80">
            Multi-season performance and shipping-margin reconciliation.
          </p>
        </header>
        <ReportsClient />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
