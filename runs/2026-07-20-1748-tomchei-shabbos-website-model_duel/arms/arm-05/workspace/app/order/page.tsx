import { redirect } from "next/navigation";
import { OrderBuilder } from "@/app/components/order-builder";
import { StorefrontShell } from "@/app/components/storefront-shell";
import { getStorefront } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function OrderPage() {
  const { currentSeason } = await getStorefront();
  if (!currentSeason) redirect("/catalog");
  return (
    <StorefrontShell isOpen>
      <main>
        <OrderBuilder products={currentSeason.products} />
      </main>
    </StorefrontShell>
  );
}
