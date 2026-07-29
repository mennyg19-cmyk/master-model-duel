import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSetting } from "@/lib/settings";
import { countUnscheduledBulkPackages, listBulkSchedules } from "@/lib/bulk/schedule";
import { formatBatchTimestamp } from "@/lib/packages/fulfillment";
import { Card, CardTitle } from "@/components/ui/card";
import { BulkScheduleForm } from "@/app/(admin)/admin/bulk/bulk-schedule-form";

export const metadata: Metadata = { title: "Bulk delivery" };
export const dynamic = "force-dynamic";

// G-021/R-079: bulk delivery scheduling — one action snapshots every
// unscheduled bulk package onto a delivery day and notifies each distinct
// customer once (email + SMS). History lists past schedules with counts.
export default async function AdminBulkPage() {
  await requirePermission("fulfillment.manage");
  const openSeason = await getOpenSeason();

  if (!openSeason) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Bulk delivery</h1>
        <p className="mt-4 text-sm text-stone-600">No open season.</p>
      </div>
    );
  }

  const [schedules, pendingCount, deliveryDays] = await Promise.all([
    listBulkSchedules(openSeason.id),
    countUnscheduledBulkPackages(openSeason.id),
    getSetting("delivery.days"),
  ]);

  return (
    <div data-bulk-page>
      <h1 className="text-2xl font-semibold">Bulk delivery — {openSeason.name}</h1>

      <Card className="mt-5 p-5">
        <CardTitle>Schedule a bulk run</CardTitle>
        <p className="mt-1 text-sm text-stone-600">
          <span className="font-medium" data-bulk-pending>{pendingCount}</span> unscheduled bulk package(s) waiting.
          Scheduling stamps the day on each and sends one email + one SMS per distinct customer.
        </p>
        <BulkScheduleForm deliveryDays={deliveryDays ?? []} disabled={pendingCount === 0} />
      </Card>

      <Card className="mt-4 p-5">
        <CardTitle>Schedule history</CardTitle>
        <ul className="mt-3 flex flex-col gap-2 text-sm" data-bulk-history>
          {schedules.map((schedule) => (
            <li key={schedule.id} className="flex flex-wrap items-center justify-between gap-2" data-bulk-row={schedule.id}>
              <span className="font-medium">
                {schedule.deliveryDay}
                {schedule.window ? ` (${schedule.window})` : ""}
              </span>
              <span className="text-xs text-stone-500">
                {schedule.packageCount} package(s) · {schedule.customerCount} customer(s) · scheduled{" "}
                {formatBatchTimestamp(schedule.createdAt)}
                {schedule.notifiedAt ? " · notified" : ""}
              </span>
            </li>
          ))}
          {schedules.length === 0 && <li className="text-stone-500">No bulk runs scheduled yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
