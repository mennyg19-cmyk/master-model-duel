import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { createRouteLink } from "@/lib/routes/links";
import { getOpenSeason } from "@/lib/season";

const createSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4}$/, "PIN is 4 digits")
    .nullable()
    .optional(),
});

/**
 * Mint (or rotate) the route's driver magic link (UR-004). The token is
 * returned exactly once — only its hash is stored. The manager texts the PIN
 * separately when one is set.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const route = await db.deliveryRoute.findFirst({ where: { id, seasonId: season.id } });
  if (!route) return Response.json({ error: "Route not found" }, { status: 404 });
  if (route.status === "COMPLETED") {
    return Response.json({ error: "This route already completed — links stay expired" }, { status: 409 });
  }

  const { link, url } = await createRouteLink(route.id, parsed.data.pin ?? null, gate.staff.realUser.id);
  await writeAudit(gate.staff, {
    action: "route.link.created",
    targetType: "DeliveryRoute",
    targetId: route.id,
    detail: { linkId: link.id, pinProtected: Boolean(parsed.data.pin) },
  });
  return Response.json({ ok: true, url, linkId: link.id });
}
