import { NextResponse } from "next/server";
import { SeasonStatus } from "@prisma/client";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiErrorResponse } from "@/lib/api-error";

const schema = z.object({
  seasonId: z.string().min(1),
  status: z.nativeEnum(SeasonStatus),
});

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = schema.parse(await request.json());

    if (body.status === SeasonStatus.OPEN) {
      await db.season.updateMany({
        where: { status: SeasonStatus.OPEN, NOT: { id: body.seasonId } },
        data: { status: SeasonStatus.CLOSED },
      });
    }

    const season = await db.season.update({
      where: { id: body.seasonId },
      data: { status: body.status },
    });

    await writeAudit({
      action: "SETTINGS_UPDATED",
      actorId: ctx.effectiveStaff.id,
      meta: { seasonId: season.id, status: season.status, kind: "season_gate" },
    });

    return NextResponse.json({ ok: true, season });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
