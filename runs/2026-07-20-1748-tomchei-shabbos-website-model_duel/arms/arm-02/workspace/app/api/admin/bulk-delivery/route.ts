import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { ActionError } from "@/lib/packages/actions";
import { scheduleBulkDelivery } from "@/lib/bulk-delivery";
import { getOpenSeason } from "@/lib/season";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is YYYY-MM-DD"),
  window: z.string().min(1).max(60),
});

/** Schedule the bulk drop + notify every affected customer once (R-078, G-021). */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  try {
    const result = await scheduleBulkDelivery(season.id, parsed.data, gate.staff.realUser.id);
    await writeAudit(gate.staff, {
      action: "bulk_delivery.scheduled",
      targetType: "BulkDeliverySchedule",
      targetId: result.schedule.id,
      detail: { date: parsed.data.date, window: parsed.data.window, customers: result.customers, packages: result.packages },
    });
    return Response.json({ ok: true, scheduleId: result.schedule.id, notified: result.notified, customers: result.customers });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
