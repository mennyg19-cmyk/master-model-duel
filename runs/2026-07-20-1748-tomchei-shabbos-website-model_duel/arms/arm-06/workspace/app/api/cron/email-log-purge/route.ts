import { purgeEmailLog } from "@/lib/email/purge";
import { cronRoute } from "@/lib/cron-route";

export const dynamic = "force-dynamic";

export const GET = cronRoute(() => purgeEmailLog());
