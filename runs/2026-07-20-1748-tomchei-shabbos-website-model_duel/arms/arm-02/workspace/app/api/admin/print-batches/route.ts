import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError } from "@/lib/packages/actions";
import { reprintFilingGroup, reprintOrder, runNightlyBatch } from "@/lib/print/batches";
import { getOpenSeason } from "@/lib/season";

const batchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("nightly") }),
  z.object({ action: z.literal("reprint-group"), filingGroup: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("reprint-order"), orderId: z.string().min(1) }),
]);

export async function POST(request: Request) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;

  const parsed = batchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  try {
    const input = parsed.data;
    const actorId = gate.staff.realUser.id;
    const result =
      input.action === "nightly"
        ? await runNightlyBatch(season.id, actorId)
        : input.action === "reprint-group"
          ? { batch: await reprintFilingGroup(season.id, input.filingGroup, actorId), replayed: false }
          : { batch: await reprintOrder(season.id, input.orderId, actorId), replayed: false };

    if (!result.replayed) {
      await writeAudit(gate.staff, {
        action: `print.${input.action}`,
        targetType: "PrintBatch",
        targetId: result.batch.id,
        detail: { runKey: result.batch.runKey, artifacts: result.batch.artifacts.length },
      });
    }
    return Response.json({
      ok: true,
      replayed: result.replayed,
      batch: {
        id: result.batch.id,
        kind: result.batch.kind,
        runKey: result.batch.runKey,
        artifacts: result.batch.artifacts,
      },
    });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
