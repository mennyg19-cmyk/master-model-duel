import { SeasonStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveDeliveryZips } from "@/lib/store-settings";

export async function PATCH(request: Request) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const body = (await request.json()) as {
      seasonId?: string;
      storeStatus?: SeasonStatus;
      deliveryZips?: string[];
    };
    if (
      body.storeStatus !== undefined &&
      !Object.values(SeasonStatus).includes(body.storeStatus)
    ) {
      return NextResponse.json({ error: "Store status must be OPEN or CLOSED." }, { status: 400 });
    }
    if (body.deliveryZips !== undefined && !Array.isArray(body.deliveryZips)) {
      return NextResponse.json({ error: "Delivery ZIPs must be a list." }, { status: 400 });
    }

    if (body.storeStatus !== undefined) {
      if (!body.seasonId) {
        return NextResponse.json({ error: "Season ID is required to change store status." }, { status: 400 });
      }
      await db.season.update({
        where: { id: body.seasonId },
        data: { status: body.storeStatus },
      });
    }
    if (body.deliveryZips !== undefined) {
      await saveDeliveryZips(body.deliveryZips);
    }
    await db.auditLog.create({
      data: {
        actorStaffId: staffSession.actor.id,
        action: "settings.storefront_updated",
        targetType: "AppSetting",
        targetId: body.seasonId ?? "delivery-zips",
        metadata: {
          storeStatus: body.storeStatus,
          deliveryZipCount: body.deliveryZips?.length,
        },
      },
    });
    return NextResponse.json({ saved: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
