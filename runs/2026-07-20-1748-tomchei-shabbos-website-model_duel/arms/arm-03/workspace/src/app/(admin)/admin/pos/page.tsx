import { requirePermission } from "@/lib/auth";
import { OrderBuilderShell } from "@/components/order/builder-shell";
import { Forbidden } from "@/components/admin/forbidden";

/** Shared storefront/POS builder shell (R-031). POS payments land in P5/P6. */
export default async function AdminPosPage() {
  try {
    await requirePermission("admin.access");
  } catch {
    return <Forbidden message="Admin access required for POS builder." />;
  }

  return (
    <main className="min-h-screen bg-[var(--color-cream)]" data-testid="pos-builder">
      <div className="border-b bg-white px-4 py-3 text-sm font-semibold text-[var(--color-forest)]">
        POS · same cart-first builder as storefront
      </div>
      <OrderBuilderShell mode="pos" />
    </main>
  );
}
