import { AccountDashboard } from "@/app/components/account-dashboard";
import { StorefrontShell } from "@/app/components/storefront-shell";
import { getStorefront } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { currentSeason } = await getStorefront();
  return (
    <StorefrontShell isOpen={Boolean(currentSeason)}>
      <main><AccountDashboard /></main>
    </StorefrontShell>
  );
}
