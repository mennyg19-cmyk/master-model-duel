import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { getOpenSeason } from "@/lib/seasons/queries";
import { loadBuilderProducts } from "@/lib/storefront/builder-products";
import { PosShell } from "@/app/(admin)/admin/pos/pos-shell";

export const metadata: Metadata = { title: "POS" };
export const dynamic = "force-dynamic";

// R-059: the counter screen. Pick/find-or-create the customer, build the cart
// in the shared builder shell, check out with cash or check — no public POS
// payments, no Stripe on this path (UR-011).
export default async function AdminPosPage() {
  await requirePermission("payments.manage");
  const openSeason = await getOpenSeason();

  if (!openSeason) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Point of sale</h1>
        <p className="mt-4 text-sm text-stone-600" data-pos-closed>
          The store is closed — POS unlocks when a season opens.
        </p>
      </div>
    );
  }

  const products = await loadBuilderProducts(openSeason.id);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Point of sale</h1>
      <p className="mt-1 text-sm text-stone-500">Season {openSeason.name} · cash and check at the counter.</p>
      <PosShell products={products} />
    </div>
  );
}
