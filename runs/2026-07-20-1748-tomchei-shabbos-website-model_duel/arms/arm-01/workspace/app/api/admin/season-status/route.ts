import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

const toggleSchema = z.object({
  seasonId: z.string().min(1),
  status: z.enum(["OPEN", "CLOSED"]),
});

/** The storewide open/close switch (UR-008). Opening a season closes any other open one — only one sells at a time. */
export async function PATCH(request: Request) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const parsed = toggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const season = await db.season.findUnique({ where: { id: parsed.data.seasonId } });
  if (!season) return Response.json({ error: "Season not found" }, { status: 404 });

  await db.$transaction(async (tx) => {
    if (parsed.data.status === "OPEN") {
      // Only one season sells at a time: closing the displaced one is a real
      // status change, so it gets its own audit row.
      const displaced = await tx.season.findMany({
        where: { status: "OPEN", id: { not: season.id } },
      });
      for (const openSeason of displaced) {
        await tx.season.update({ where: { id: openSeason.id }, data: { status: "CLOSED" } });
        await writeAudit(
          gate.staff,
          {
            action: "season.status",
            targetType: "Season",
            targetId: openSeason.id,
            detail: { name: openSeason.name, status: "CLOSED", displacedBy: season.name },
          },
          tx
        );
      }
    }
    await tx.season.update({ where: { id: season.id }, data: { status: parsed.data.status } });
    await writeAudit(
      gate.staff,
      { action: "season.status", targetType: "Season", targetId: season.id, detail: { name: season.name, status: parsed.data.status } },
      tx
    );
  });
  return Response.json({ ok: true });
}
