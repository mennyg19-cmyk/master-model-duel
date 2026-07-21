import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { ActionError } from "@/lib/packages/actions";
import { switchPackageMethod } from "@/lib/routes/service";
import { getOpenSeason } from "@/lib/season";

const schema = z.object({ methodId: z.string().min(1) });

/**
 * Method switch shipping <-> delivery (UR-002, G-005). The customer's charge
 * is preserved — no money moves; the switch is fully audited.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick a method" }, { status: 400 });

  try {
    const { from, to } = await switchPackageMethod(season.id, id, parsed.data.methodId, {
      id: gate.staff.realUser.id,
      email: gate.staff.realUser.email,
    });
    return Response.json({ ok: true, from: from.name, to: to.name });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
