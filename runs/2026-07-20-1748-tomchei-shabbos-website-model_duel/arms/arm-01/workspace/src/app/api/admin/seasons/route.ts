import { NextResponse } from "next/server";
import { z } from "zod";
import { createSeasonFromTemplate } from "@/domain/seasons";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const seasonSchema = z.object({
  name: z.string().trim().min(1).max(120),
  year: z.number().int().min(2000).max(9999),
  sourceSeasonId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requirePermission("settings:manage");
    const parsed = seasonSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Season name and a valid year are required." },
        { status: 400 },
      );
    }
    const season = await createSeasonFromTemplate(db, {
      ...parsed.data,
      actorStaffId: session.actor.id,
    });
    return NextResponse.json({ season }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Season could not be created." },
      { status: 400 },
    );
  }
}
