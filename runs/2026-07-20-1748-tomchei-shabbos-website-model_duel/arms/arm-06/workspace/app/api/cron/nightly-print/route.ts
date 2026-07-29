import { runNightlyPrintBatch } from "@/lib/packages/print-batches";
import { cronRoute } from "@/lib/cron-route";

// UR-005/R-124: the nightly print batch, triggered by Vercel Cron (GET with
// an Authorization bearer). Every run — empty or not — leaves a CronRun row.
export const dynamic = "force-dynamic";

export const GET = cronRoute(() => runNightlyPrintBatch());
