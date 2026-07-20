import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { getSetting } from "@/lib/settings";
import { SettingsHub } from "@/components/admin/settings-hub";

export default async function SettingsPage() {
  await requirePermissionPage("settings.manage");

  const [seasons, packageTypes, pickupLocations, followupDays, closedMessage, deliveryZips, shippingRates, shippingRules, purimDayChoices, emailFrom, emailReplyTo] =
    await Promise.all([
      db.season.findMany({ select: { id: true, name: true, status: true }, orderBy: { createdAt: "desc" } }),
      db.packageType.findMany({ orderBy: { name: "asc" } }),
      db.pickupLocation.findMany({ orderBy: { name: "asc" } }),
      getSetting("orders.followup_days"),
      getSetting("store.closed_message"),
      getSetting("shipping.delivery_zips"),
      getSetting("shipping.rates"),
      getSetting("shipping.rules"),
      getSetting("delivery.purim_day_choices"),
      getSetting("email.from_address"),
      getSetting("email.reply_to"),
    ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <SettingsHub
        data={{
          seasons,
          packageTypes,
          pickupLocations,
          followupDays,
          closedMessage,
          deliveryZips,
          shippingRates,
          shippingRules,
          purimDayChoices,
          emailFrom,
          emailReplyTo,
        }}
      />
    </div>
  );
}
