import { sweepOutbox } from "@/lib/email/outbox-sweep";
import { cronRoute } from "@/lib/cron-route";

export const dynamic = "force-dynamic";

export const GET = cronRoute(() => sweepOutbox());
