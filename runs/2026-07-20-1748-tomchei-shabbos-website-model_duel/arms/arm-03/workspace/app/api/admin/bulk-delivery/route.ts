import { z } from "zod";
import { adminHandler } from "@/lib/api/admin-handler";
import { writeAudit } from "@/lib/audit";
import { scheduleBulkDelivery } from "@/lib/bulk-delivery";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is YYYY-MM-DD"),
  window: z.string().min(1).max(60),
});

/** Schedule the bulk drop + notify every affected customer once (R-078, G-021). */
export const POST = adminHandler<Record<string, never>, z.infer<typeof schema>>(
  { schema },
  async ({ staff, season, body }) => {
    const result = await scheduleBulkDelivery(season.id, body, staff.realUser.id);
    await writeAudit(staff, {
      action: "bulk_delivery.scheduled",
      targetType: "BulkDeliverySchedule",
      targetId: result.schedule.id,
      detail: { date: body.date, window: body.window, customers: result.customers, packages: result.packages },
    });
    return Response.json({ ok: true, scheduleId: result.schedule.id, notified: result.notified, customers: result.customers });
  }
);
