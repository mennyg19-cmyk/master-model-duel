import { NextResponse } from "next/server";
import { SeasonStatus } from "@prisma/client";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { setSeasonStatus } from "@/lib/seasons/manage";

const schema = z.object({
  seasonId: z.string().min(1),
  status: z.nativeEnum(SeasonStatus),
});

/** UR-008 — manager Open/Closed switch. */
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = schema.parse(await request.json());
    const result = await setSeasonStatus({
      seasonId: body.seasonId,
      status: body.status,
      staffId: ctx.staff.id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, season: result.value.season });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
