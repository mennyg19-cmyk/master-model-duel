import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { ReconcileClient } from "@/components/admin/reconcile-client";

export default async function AdminReconcilePage() {
  try {
    await requireAdminPage("settings.write");
    return (
      <main className="space-y-4" data-testid="admin-reconcile">
        <header className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Stripe reconciliation
          </h1>
          <p className="mt-1 text-sm opacity-80">
            Match PaymentIntents to local payments; flag orphans; safe to rerun.
          </p>
        </header>
        <ReconcileClient />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
