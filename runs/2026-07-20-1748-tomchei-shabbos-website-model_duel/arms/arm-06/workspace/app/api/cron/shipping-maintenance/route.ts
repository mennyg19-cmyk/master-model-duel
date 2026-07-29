import { sweepShippingMaintenance } from "@/lib/shipping/labels";
import { cronRoute } from "@/lib/cron-route";

// P8 shipping maintenance sweep: resolve PURCHASING rows stuck past the TTL,
// reconcile async void refunds with the carrier (including void rejections),
// and purge expired quote rows. Same bearer gate as nightly-print.
export const dynamic = "force-dynamic";

export const GET = cronRoute(() => sweepShippingMaintenance());
