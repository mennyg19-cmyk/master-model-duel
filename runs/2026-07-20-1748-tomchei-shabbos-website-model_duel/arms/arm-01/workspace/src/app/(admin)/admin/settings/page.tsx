import { SettingsHub } from "@/components/settings-hub";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAdminSettings, getDeliveryZips } from "@/lib/store-settings";
import { getCurrentSeason } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requirePermission("settings:manage");
  const [season, seasons, deliveryZips, adminSettings] = await Promise.all([
    getCurrentSeason(),
    db.season.findMany({ orderBy: { year: "desc" } }),
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
      seasons={seasons.map((seasonChoice) => ({
        id: seasonChoice.id,
        name: seasonChoice.name,
        year: seasonChoice.year,
        status: seasonChoice.status,
      }))}
      season={
        season
          ? {
              id: season.id,
              name: season.name,
              status: season.status,
              scheduledStatus: season.scheduledStatus,
              scheduledStatusAt: season.scheduledStatusAt?.toISOString() ?? null,
            }
          : null
      }
    />
  );
}
