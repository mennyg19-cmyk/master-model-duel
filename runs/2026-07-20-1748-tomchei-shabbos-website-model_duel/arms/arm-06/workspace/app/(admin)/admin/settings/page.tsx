import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSetting } from "@/lib/settings";
import { isBlobDriver } from "@/lib/media/storage";
import { SettingsTabs } from "@/app/(admin)/admin/settings/settings-tabs";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

// R-094/R-095: settings hub — Orders, Shipping, Email, Developer tabs.
export default async function AdminSettingsPage() {
  await requirePermission("settings.manage");

  const [deliveryZips, rates, rules, packageTypes, pickupLocations, openSeason] = await Promise.all([
    getSetting("shipping.deliveryZips"),
    getSetting("shipping.rates"),
    getSetting("shipping.rules"),
    prisma.packageType.findMany({ orderBy: { name: "asc" } }),
    prisma.pickupLocation.findMany({ orderBy: { name: "asc" } }),
    getOpenSeason(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsTabs
        storeStatus={openSeason ? `Open — season ${openSeason.name}` : "Closed — no open season"}
        shipping={{
          deliveryZips: deliveryZips ?? [],
          rates: rates ?? [],
          rules: rules ?? [],
        }}
        orders={{
          packageTypes: packageTypes.map((packageType) => ({
            id: packageType.id,
            name: packageType.name,
            lengthMm: packageType.lengthMm,
            widthMm: packageType.widthMm,
            heightMm: packageType.heightMm,
            maxWeightGrams: packageType.maxWeightGrams,
            active: packageType.active,
          })),
          pickupLocations: pickupLocations.map((location) => ({
            id: location.id,
            name: location.name,
            line1: location.line1,
            city: location.city,
            region: location.region,
            postalCode: location.postalCode,
            active: location.active,
          })),
        }}
        developer={{ storageDriver: isBlobDriver() ? "Vercel Blob" : "local (.uploads)" }}
      />
    </div>
  );
}
