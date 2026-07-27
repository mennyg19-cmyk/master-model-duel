import { CatalogGrid } from "@/app/components/catalog-grid";
import { StorefrontShell } from "@/app/components/storefront-shell";
import { getStorefront } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const { currentSeason } = await getStorefront();
  const products = currentSeason?.products ?? [];
  return (
    <StorefrontShell isOpen={Boolean(currentSeason)}>
      <main>
        <p className="eyebrow">{currentSeason?.name ?? "The shop is closed"}</p>
        <h1>Share a Purim gift.</h1>
        <p className="lead">{currentSeason ? "Choose a box, see every option, and begin an order when you are ready." : "There is no open collection right now. Past years remain available to browse."}</p>
        <CatalogGrid canOrder={Boolean(currentSeason)} products={products} />
      </main>
    </StorefrontShell>
  );
}
