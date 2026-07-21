import { getCurrentSeason, isStoreOpen } from "@/lib/storefront/season";
import { StorefrontShell } from "@/components/storefront/shell";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const season = await getCurrentSeason();
  const storeOpen = isStoreOpen(season);
  return (
    <div data-route-group="storefront">
      <StorefrontShell storeOpen={storeOpen} seasonName={season?.name}>
        {children}
      </StorefrontShell>
    </div>
  );
}
