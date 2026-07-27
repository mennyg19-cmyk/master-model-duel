import { prisma } from "@/lib/db";
export { formatMoney } from "@/lib/foundation";

export const defaultDeliveryZipCodes = ["11201", "11205", "11211"];

export async function getStorefront() {
  const [currentSeason, archives] = await Promise.all([
    prisma.season.findFirst({
      where: { status: "OPEN" },
      orderBy: { year: "desc" },
      include: {
        products: {
          where: { isActive: true, kind: { not: "ADD_ON" } },
          include: {
            options: { where: { isActive: true } },
            restrictedAddons: {
              include: { addOnProduct: { include: { inventoryItems: true } } },
            },
            media: true,
            inventoryItems: true,
          },
          orderBy: { name: "asc" },
        },
      },
    }),
    prisma.season.findMany({
      where: { status: "CLOSED" },
      orderBy: { year: "desc" },
      include: {
        products: {
          where: { isActive: true, kind: { not: "ADD_ON" } },
          include: { media: true },
          orderBy: { name: "asc" },
        },
      },
    }),
  ]);

  return { currentSeason, archives };
}

export async function getDeliveryZipCodes() {
  const setting = await prisma.appSetting.findUnique({ where: { key: "delivery.zipCodes" } });
  if (!setting || !Array.isArray(setting.value)) return defaultDeliveryZipCodes;
  return setting.value.filter((zipCode): zipCode is string => typeof zipCode === "string");
}
