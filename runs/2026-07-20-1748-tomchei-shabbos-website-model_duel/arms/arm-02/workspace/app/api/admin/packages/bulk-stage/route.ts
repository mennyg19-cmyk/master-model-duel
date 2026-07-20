import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError, advancePackageStage } from "@/lib/packages/actions";
import { canAdvancePackage } from "@/lib/domain/package-stage";
import { getOpenSeason } from "@/lib/season";

const BULK_LIMIT = 200;

// Two shapes (R-072): the board sends explicit ids (each version-guarded, with
// a done/skipped report like orders bulk); the channel dashboard moves every
// package of a method from one stage to the next in a single atomic UPDATE.
const bulkSchema = z.union([
  z.object({
    ids: z.array(z.string().min(1)).min(1).max(BULK_LIMIT),
    to: z.enum(["PRINTED", "PACKED", "SENT", "PICKED_UP"]),
  }),
  z.object({
    methodId: z.string().min(1),
    from: z.enum(["NEW", "PRINTED", "PACKED"]),
    to: z.enum(["PRINTED", "PACKED", "SENT", "PICKED_UP"]),
  }),
]);

export async function POST(request: Request) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;

  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  if ("methodId" in parsed.data) {
    const { methodId, from, to } = parsed.data;
    const method = await db.fulfillmentMethod.findUnique({ where: { id: methodId } });
    if (!method) return Response.json({ error: "Unknown fulfillment channel" }, { status: 404 });
    const allowed = canAdvancePackage(from, to, method.kind);
    if (!allowed.ok) return Response.json({ error: allowed.reason }, { status: 409 });
    const season = await getOpenSeason();
    if (!season) return Response.json({ error: "No open season" }, { status: 409 });

    const moved = await db.$transaction(async (tx) => {
      const update = await tx.package.updateMany({
        where: { seasonId: season.id, fulfillmentMethodId: methodId, stage: from, lines: { some: {} } },
        data: { stage: to, version: { increment: 1 } },
      });
      await writeAudit(
        gate.staff,
        {
          action: "packages.bulk_stage",
          targetType: "FulfillmentMethod",
          targetId: methodId,
          detail: { channel: method.code, from, to, moved: update.count },
        },
        tx
      );
      return update.count;
    });
    return Response.json({ ok: true, moved, from, to });
  }

  const ids = [...new Set(parsed.data.ids)].sort();
  const { to } = parsed.data;
  const done: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const current = await db.package.findUnique({ where: { id }, select: { version: true } });
      if (!current) throw new ActionError("Package not found", 404);
      await advancePackageStage(id, to, current.version, gate.staff.realUser.id);
      done.push(id);
    } catch (error) {
      skipped.push({ id, reason: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  await writeAudit(gate.staff, {
    action: "packages.bulk_stage",
    targetType: "Package",
    detail: { to, requested: ids.length, done, skipped },
  });
  return Response.json({ ok: true, to, done, skipped });
}
