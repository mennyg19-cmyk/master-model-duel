import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { isTestMode } from "@/lib/test-mode";
import { wipeOpenSeason, seedDemoOrder } from "@/lib/test-console";

// Test-console destructive routes (R-103). Fail-closed: outside test mode the
// route pretends not to exist (404) — a live deploy has no wipe endpoint.

const actionSchema = z.object({ action: z.enum(["wipe", "seed", "reseed"]) });

export async function POST(request: Request) {
  if (!isTestMode()) return Response.json({ error: "Not found" }, { status: 404 });

  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "action must be wipe | seed | reseed" }, { status: 400 });

  const { action } = parsed.data;
  const detail: Record<string, unknown> = { action };

  if (action === "wipe" || action === "reseed") {
    const wiped = await wipeOpenSeason();
    detail.wiped = wiped.counts;
    detail.seasonName = wiped.seasonName;
  }
  if (action === "seed" || action === "reseed") {
    const seeded = await seedDemoOrder();
    detail.seededOrderNumber = seeded.orderNumber;
  }

  await writeAudit(gate.staff, { action: `test_console.${action}`, targetType: "Season", detail: detail as never });
  return Response.json({ ok: true, ...detail });
}
