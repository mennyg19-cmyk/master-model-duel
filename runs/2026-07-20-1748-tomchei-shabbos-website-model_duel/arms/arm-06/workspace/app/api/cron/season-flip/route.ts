import { runSeasonFlip } from "@/lib/seasons/manage";
import { cronRoute } from "@/lib/cron-route";

// P10 (R-041/UR-008): scheduled season auto-flip, Vercel Cron (GET +
// Authorization bearer, same as the other crons). Every run leaves a
// CronRun row inside runSeasonFlip.
export const dynamic = "force-dynamic";

export const GET = cronRoute(() => runSeasonFlip());
