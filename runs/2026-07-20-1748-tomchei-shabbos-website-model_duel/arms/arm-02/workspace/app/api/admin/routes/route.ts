import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError } from "@/lib/packages/actions";
import { buildRoute } from "@/lib/routes/service";
import { getOpenSeason } from "@/lib/season";

const createSchema = z.object({
  methodId: z.string().min(1),
  name: z.string().max(120).optional(),
  maxStops: z.number().int().min(1).max(200).optional(),
});

/** Build a delivery route from unassigned packages (R-074). */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick a delivery method" }, { status: 400 });

  try {
    const { route, stopCount } = await buildRoute(season.id, parsed.data, gate.staff.realUser.id);
    await writeAudit(gate.staff, {
      action: "route.created",
      targetType: "DeliveryRoute",
      targetId: route.id,
      detail: { name: route.name, stopCount },
    });
    return Response.json({ ok: true, routeId: route.id, stopCount });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
