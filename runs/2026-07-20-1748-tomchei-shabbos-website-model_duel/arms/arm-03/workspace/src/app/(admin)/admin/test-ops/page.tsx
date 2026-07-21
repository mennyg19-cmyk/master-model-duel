import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { TestOpsClient } from "@/components/admin/test-ops-client";

export default async function AdminTestOpsPage() {
  try {
    await requireAdminPage("settings.write");
    return (
      <main className="space-y-4" data-testid="admin-test-ops">
        <header className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Test console
          </h1>
          <p className="mt-1 text-sm opacity-80">
            Test-mode banner, wipe/reseed hooks, dress rehearsal, scale print probe.
          </p>
        </header>
        <TestOpsClient />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
