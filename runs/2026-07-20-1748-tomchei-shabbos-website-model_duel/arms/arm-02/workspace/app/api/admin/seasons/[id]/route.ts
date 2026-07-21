import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

const scheduleSchema = z.object({
  opensAt: z.coerce.date().nullable().optional(),
  closesAt: z.coerce.date().nullable().optional(),
});

/** Edit a season's one-shot auto-flip schedule (UR-008). null clears a side. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = scheduleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const season = await db.season.findUnique({ where: { id } });
  if (!season) return Response.json({ error: "Season not found" }, { status: 404 });

  const opensAt = parsed.data.opensAt === undefined ? season.opensAt : parsed.data.opensAt;
  const closesAt = parsed.data.closesAt === undefined ? season.closesAt : parsed.data.closesAt;
  if (opensAt && closesAt && closesAt <= opensAt) {
    return Response.json({ error: "The close time must be after the open time" }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    await tx.season.update({ where: { id }, data: { opensAt, closesAt } });
    await writeAudit(
      gate.staff,
      {
        action: "season.schedule",
        targetType: "Season",
        targetId: id,
        detail: { opensAt: opensAt?.toISOString() ?? null, closesAt: closesAt?.toISOString() ?? null },
      },
      tx
    );
  });
  return Response.json({ ok: true });
}
