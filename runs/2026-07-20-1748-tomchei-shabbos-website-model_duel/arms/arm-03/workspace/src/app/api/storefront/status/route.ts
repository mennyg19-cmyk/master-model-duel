import { NextResponse } from "next/server";
import { getCurrentSeason, isStoreOpen } from "@/lib/storefront/season";
import {
  DEFAULT_DELIVERY_ZIPS,
  STORE_SETTINGS,
  isDeliveryZipAllowed,
  type DeliveryZipsSetting,
} from "@/lib/storefront/settings-keys";
import { getSetting } from "@/lib/settings";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const zip = url.searchParams.get("zip");
  const season = await getCurrentSeason();
  const deliveryZips =
    (await getSetting<DeliveryZipsSetting>(STORE_SETTINGS.deliveryZips)) ?? DEFAULT_DELIVERY_ZIPS;

  return NextResponse.json({
    ok: true,
    storeOpen: isStoreOpen(season),
    season: season ? { id: season.id, slug: season.slug, name: season.name, status: season.status } : null,
    deliveryZips: deliveryZips.zips,
    zipAllowed: zip ? isDeliveryZipAllowed(zip, deliveryZips.zips) : null,
    checkedZip: zip,
  });
}
