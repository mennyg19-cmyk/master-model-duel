import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError, regroupPackages } from "@/lib/packages/actions";

const regroupSchema = z.object({
  ids: z.array(z.string().min(1)).min(2).max(50),
});

export async function POST(request: Request) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;

  const parsed = regroupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await regroupPackages(parsed.data.ids, gate.staff.realUser.id);
    await writeAudit(gate.staff, {
      action: "package.regroup",
      targetType: "Package",
      targetId: result.targetId,
      detail: { mergedIds: result.mergedIds },
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
