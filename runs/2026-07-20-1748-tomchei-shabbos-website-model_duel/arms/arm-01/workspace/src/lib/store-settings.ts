import { db } from "@/lib/db";

const deliveryZipKey = "delivery-zips";

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
