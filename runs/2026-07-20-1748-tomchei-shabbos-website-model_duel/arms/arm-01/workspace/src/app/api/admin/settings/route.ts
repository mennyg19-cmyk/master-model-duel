import { SeasonStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { scheduleSeasonStatus, setSeasonStatus } from "@/domain/seasons";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  type AdminSettings,
  saveAdminSettings,
  saveDeliveryZips,
} from "@/lib/store-settings";

export async function PATCH(request: Request) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const body = (await request.json()) as {
      seasonId?: string;
      storeStatus?: SeasonStatus;
      scheduledStatus?: SeasonStatus;
      scheduledStatusAt?: string;
      deliveryZips?: string[];
      adminSettings?: AdminSettings;
    };
    if (
      body.storeStatus !== undefined &&
      !Object.values(SeasonStatus).includes(body.storeStatus)
    ) {
      return NextResponse.json({ error: "Store status must be OPEN or CLOSED." }, { status: 400 });
    }
    if (
      body.scheduledStatus !== undefined &&
      !Object.values(SeasonStatus).includes(body.scheduledStatus)
    ) {
      return NextResponse.json({ error: "Scheduled status must be OPEN or CLOSED." }, { status: 400 });
    }
    if (body.storeStatus !== undefined && body.scheduledStatus !== undefined) {
      return NextResponse.json(
        { error: "Change status now or schedule it, not both." },
        { status: 400 },
      );
    }
    if (body.deliveryZips !== undefined && !Array.isArray(body.deliveryZips)) {
      return NextResponse.json({ error: "Delivery ZIPs must be a list." }, { status: 400 });
    }
    if (
      body.adminSettings !== undefined &&
      (!Number.isInteger(body.adminSettings.followUpDays) ||
        body.adminSettings.followUpDays < 0 ||
        body.adminSettings.followUpDays > 30 ||
        !body.adminSettings.emailSenderName?.trim() ||
        !body.adminSettings.operationsAlert?.trim() ||
        !body.adminSettings.developerWebhookLabel?.trim())
    ) {
      return NextResponse.json({ error: "Admin settings are invalid." }, { status: 400 });
    }

    if (body.storeStatus !== undefined) {
      if (!body.seasonId) {
        return NextResponse.json({ error: "Season ID is required to change store status." }, { status: 400 });
      }
      await setSeasonStatus(db, {
        seasonId: body.seasonId,
        status: body.storeStatus,
        actorStaffId: staffSession.actor.id,
      });
    }
    if (body.scheduledStatus !== undefined) {
      if (!body.seasonId || !body.scheduledStatusAt) {
        return NextResponse.json(
          { error: "Season ID and scheduled time are required." },
          { status: 400 },
        );
      }
      try {
        await scheduleSeasonStatus(db, {
          seasonId: body.seasonId,
          status: body.scheduledStatus,
          scheduledAt: new Date(body.scheduledStatusAt),
          actorStaffId: staffSession.actor.id,
        });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Schedule is invalid." },
          { status: 400 },
        );
      }
    }
    if (body.deliveryZips !== undefined) {
      await saveDeliveryZips(body.deliveryZips);
    }
    if (body.adminSettings !== undefined) {
      await saveAdminSettings(body.adminSettings);
    }
    await db.auditLog.create({
      data: {
        actorStaffId: staffSession.actor.id,
        action: "settings.storefront_updated",
        targetType: "AppSetting",
        targetId: body.seasonId ?? "delivery-zips",
        metadata: {
          storeStatus: body.storeStatus,
          scheduledStatus: body.scheduledStatus,
          scheduledStatusAt: body.scheduledStatusAt,
          deliveryZipCount: body.deliveryZips?.length,
          adminSettingsChanged: body.adminSettings !== undefined,
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
