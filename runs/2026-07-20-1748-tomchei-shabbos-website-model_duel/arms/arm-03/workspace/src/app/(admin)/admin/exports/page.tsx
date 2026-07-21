import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { ExportsClient } from "@/components/admin/exports-client";

export default async function AdminExportsPage() {
  try {
    await requireAdminPage("settings.write");
    return (
      <main className="space-y-4" data-testid="admin-exports">
        <header className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            CSV export center
          </h1>
          <p className="mt-1 text-sm opacity-80">
            Deliveries, year metrics, item sales, lapsed customers, shipping margin — with audit
            history.
          </p>
        </header>
        <ExportsClient />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
