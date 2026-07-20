import { db } from "@/lib/db";

const deliveryZipKey = "delivery-zips";
const adminSettingsKey = "admin-settings";

export type AdminSettings = {
  followUpDays: number;
  emailSenderName: string;
  operationsAlert: string;
  developerWebhookLabel: string;
};

const defaultAdminSettings: AdminSettings = {
  followUpDays: 3,
  emailSenderName: "Tomchei Shabbos",
  operationsAlert: "Purim operations are live.",
  developerWebhookLabel: "Stripe checkout webhook",
};

export async function getDeliveryZips() {
  const setting = await db.appSetting.findUnique({
    where: { key: deliveryZipKey },
  });
  if (!setting || !Array.isArray(setting.value)) {
    return ["08701"];
  }
  return setting.value.filter(
    (postalCode): postalCode is string => typeof postalCode === "string",
  );
}

export async function saveDeliveryZips(postalCodes: string[]) {
  const normalizedPostalCodes = [
    ...new Set(postalCodes.map((postalCode) => postalCode.trim()).filter(Boolean)),
  ];
  return db.appSetting.upsert({
    where: { key: deliveryZipKey },
    create: { key: deliveryZipKey, value: normalizedPostalCodes },
    update: {
      value: normalizedPostalCodes,
      version: { increment: 1 },
    },
  });
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const setting = await db.appSetting.findUnique({ where: { key: adminSettingsKey } });
  if (!setting || typeof setting.value !== "object" || Array.isArray(setting.value)) {
    return defaultAdminSettings;
  }
  const value = setting.value as Record<string, unknown>;
  return {
    followUpDays:
      typeof value.followUpDays === "number" ? value.followUpDays : defaultAdminSettings.followUpDays,
    emailSenderName:
      typeof value.emailSenderName === "string" ? value.emailSenderName : defaultAdminSettings.emailSenderName,
    operationsAlert:
      typeof value.operationsAlert === "string" ? value.operationsAlert : defaultAdminSettings.operationsAlert,
    developerWebhookLabel:
      typeof value.developerWebhookLabel === "string"
        ? value.developerWebhookLabel
        : defaultAdminSettings.developerWebhookLabel,
  };
}

export async function saveAdminSettings(settings: AdminSettings) {
  return db.appSetting.upsert({
    where: { key: adminSettingsKey },
    create: { key: adminSettingsKey, value: settings },
    update: { value: settings, version: { increment: 1 } },
  });
}
