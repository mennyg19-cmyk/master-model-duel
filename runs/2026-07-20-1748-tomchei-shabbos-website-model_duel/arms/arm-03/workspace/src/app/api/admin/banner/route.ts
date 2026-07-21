import { NextResponse } from "next/server";
import { z } from "zod";
import { AuditAction } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getSetting, setSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { OPS_SETTINGS, type AlertBannerSetting } from "@/lib/ops/settings-keys";

export async function GET() {
  try {
    await requirePermission("admin.access");
    const banner =
      (await getSetting<AlertBannerSetting>(OPS_SETTINGS.alertBanner)) ?? {
        message: "",
        active: false,
        tone: "info" as const,
      };
    return NextResponse.json({ ok: true, banner });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const patchSchema = z.object({
  message: z.string().max(500),
  active: z.boolean().optional(),
  tone: z.enum(["info", "warn"]).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export async function PATCH(request: Request) {
  try {
    const staff = await requirePermission("settings.write");
    const body = patchSchema.parse(await request.json());
    const value: AlertBannerSetting = {
      message: body.message,
      active: body.active ?? Boolean(body.message.trim()),
      tone: body.tone ?? "info",
    };
    const result = await setSetting(OPS_SETTINGS.alertBanner, value, body.expectedVersion);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    await writeAudit({
      action: AuditAction.ADMIN_BANNER_UPDATED,
      actorId: staff.effectiveStaff.id,
      meta: value,
    });
    return NextResponse.json({ ok: true, banner: value, version: result.value.version });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
