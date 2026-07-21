import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { FulfillmentDashboardClient } from "@/components/admin/fulfillment-dashboard";

export default async function FulfillmentPage() {
  try {
    await requireAdminPage("admin.access");
    return (
      <main className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Fulfillment channels
        </h1>
        <p className="text-sm opacity-70">
          Production summaries and bulk status actions by fulfillment method.
        </p>
        <FulfillmentDashboardClient />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
