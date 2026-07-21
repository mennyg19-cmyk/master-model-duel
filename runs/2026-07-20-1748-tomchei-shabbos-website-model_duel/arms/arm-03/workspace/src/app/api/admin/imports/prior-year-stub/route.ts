import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getEnv } from "@/lib/env";
import { seedImportedPriorYearOrder } from "@/lib/ops/prior-year-stub";

/** Dev/test hook for P10 S3 — creates an imported prior-year order stub. */
export async function POST() {
  try {
    const env = getEnv();
    if (env.AUTH_MODE !== "dev" || env.NODE_ENV === "production") {
      return NextResponse.json({ ok: false, error: "Dev only" }, { status: 404 });
    }
    const ctx = await requirePermission("settings.write");
    const result = await seedImportedPriorYearOrder({ actorId: ctx.staff.id });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
