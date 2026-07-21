import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { apiErrorResponse } from "@/lib/api-error";
import {
  DEFAULT_DELIVERY_ZIPS,
  STORE_SETTINGS,
  type DeliveryZipsSetting,
} from "@/lib/storefront/settings-keys";
import { db } from "@/lib/db";
import { isDeliveryZipAllowed } from "@/lib/storefront/settings-keys";

const patchSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  expectedVersion: z.number().int().positive().optional(),
});

export async function GET(request: Request) {
  try {
    await requirePermission("settings.read");
    const url = new URL(request.url);
    const checkZip = url.searchParams.get("checkZip");

    const deliveryZips =
      (await getSetting<DeliveryZipsSetting>(STORE_SETTINGS.deliveryZips)) ?? DEFAULT_DELIVERY_ZIPS;
    const packageTypes = await db.packageType.findMany({ orderBy: { code: "asc" } });
    const pickupLocations = await db.pickupLocation.findMany({ orderBy: { code: "asc" } });

    const payload: Record<string, unknown> = {
      ok: true,
      deliveryZips,
      packageTypes,
      pickupLocations,
      storeStatus: await getSetting(STORE_SETTINGS.storeStatus),
      shippingRates: await getSetting(STORE_SETTINGS.shippingRates),
      shippingRules: await getSetting(STORE_SETTINGS.shippingRules),
      emailFrom: await getSetting(STORE_SETTINGS.emailFrom),
      emailReplyTo: await getSetting(STORE_SETTINGS.emailReplyTo),
      developerNotes: await getSetting(STORE_SETTINGS.developerNotes),
    };

    if (checkZip) {
      payload.zipAllowed = isDeliveryZipAllowed(checkZip, deliveryZips.zips);
      payload.checkedZip = checkZip;
    }

    return NextResponse.json(payload);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = patchSchema.parse(await request.json());
    const allowed = new Set(Object.values(STORE_SETTINGS));
    if (!allowed.has(body.key as (typeof STORE_SETTINGS)[keyof typeof STORE_SETTINGS])) {
      return NextResponse.json({ error: "Unknown settings key" }, { status: 400 });
    }

    let value = body.value as never;
    if (body.key === STORE_SETTINGS.deliveryZips) {
      const zips = z
        .object({ zips: z.array(z.string().min(3).max(10)) })
        .parse(body.value);
      value = { zips: zips.zips.map((z) => z.trim()) } as never;
    }

    const result = await setSetting(body.key, value as never, body.expectedVersion);
    if (!result.ok) {
      return NextResponse.json({ error: result.publicMessage }, { status: 409 });
    }
    await writeAudit({
      action: "SETTINGS_UPDATED",
      actorId: ctx.effectiveStaff.id,
      meta: { key: body.key },
    });
    return NextResponse.json({ ok: true, version: result.value.version });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
