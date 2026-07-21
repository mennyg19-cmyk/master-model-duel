import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { createSeason, listSeasons, scheduleSeasonFlip } from "@/lib/seasons/manage";

export async function GET() {
  try {
    await requirePermission("settings.read");
    const seasons = await listSeasons();
    return NextResponse.json({ ok: true, seasons });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  year: z.number().int().min(2000).max(2100),
  slug: z.string().min(1).max(60).optional(),
  copyFromSeasonId: z.string().min(1).nullable().optional(),
  scheduledOpenAt: z.string().datetime().nullable().optional(),
  scheduledCloseAt: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = createSchema.parse(await request.json());
    const result = await createSeason({
      name: body.name,
      year: body.year,
      slug: body.slug,
      copyFromSeasonId: body.copyFromSeasonId,
      scheduledOpenAt: body.scheduledOpenAt ? new Date(body.scheduledOpenAt) : null,
      scheduledCloseAt: body.scheduledCloseAt ? new Date(body.scheduledCloseAt) : null,
      staffId: ctx.staff.id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const scheduleSchema = z.object({
  seasonId: z.string().min(1),
  scheduledOpenAt: z.string().datetime().nullable().optional(),
  scheduledCloseAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requirePermission("settings.write");
    const body = scheduleSchema.parse(await request.json());
    const result = await scheduleSeasonFlip({
      seasonId: body.seasonId,
      scheduledOpenAt:
        body.scheduledOpenAt === undefined
          ? undefined
          : body.scheduledOpenAt
            ? new Date(body.scheduledOpenAt)
            : null,
      scheduledCloseAt:
        body.scheduledCloseAt === undefined
          ? undefined
          : body.scheduledCloseAt
            ? new Date(body.scheduledCloseAt)
            : null,
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
