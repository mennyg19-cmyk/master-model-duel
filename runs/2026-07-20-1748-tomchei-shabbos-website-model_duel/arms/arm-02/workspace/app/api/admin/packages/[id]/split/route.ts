import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError, splitPackage } from "@/lib/packages/actions";

const splitSchema = z.object({
  parts: z.array(z.object({ lineId: z.string().min(1), quantity: z.number().int().min(1) })).min(1).max(50),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const parsed = splitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await splitPackage(id, parsed.data.parts, gate.staff.realUser.id);
    await writeAudit(gate.staff, {
      action: "package.split",
      targetType: "Package",
      targetId: id,
      detail: { newPackageId: result.targetId, parts: parsed.data.parts },
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
