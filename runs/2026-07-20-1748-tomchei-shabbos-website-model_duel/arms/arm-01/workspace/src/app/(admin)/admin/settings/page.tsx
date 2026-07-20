import { SettingsHub } from "@/components/settings-hub";
import { requirePermission } from "@/lib/auth";
import { getAdminSettings, getDeliveryZips } from "@/lib/store-settings";
import { getCurrentSeason } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requirePermission("settings:manage");
  const [season, deliveryZips, adminSettings] = await Promise.all([
    getCurrentSeason(),
    getDeliveryZips(),
    getAdminSettings(),
  ]);

  return (
    <SettingsHub
      initialDeliveryZips={deliveryZips}
      initialAdminSettings={adminSettings}
      packageTypes={
        season?.packageTypes?.map((packageType) => ({
          id: packageType.id,
          name: packageType.name,
        })) ?? []
      }
      pickupLocations={
        season?.pickupLocations?.map((location) => ({
          id: location.id,
          name: location.name,
          isActive: location.isActive,
        })) ?? []
      }
      season={
        season
          ? { id: season.id, name: season.name, status: season.status }
          : null
      }
    />
  );
}
