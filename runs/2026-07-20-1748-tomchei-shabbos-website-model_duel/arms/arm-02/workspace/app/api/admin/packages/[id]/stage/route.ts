import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError, advancePackageStage } from "@/lib/packages/actions";

const stageSchema = z.object({
  to: z.enum(["PRINTED", "PACKED", "SENT", "PICKED_UP"]),
  version: z.number().int().min(0),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const parsed = stageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await advancePackageStage(id, parsed.data.to, parsed.data.version, gate.staff.realUser.id);
    await writeAudit(gate.staff, {
      action: "package.stage",
      targetType: "Package",
      targetId: id,
      detail: result,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
