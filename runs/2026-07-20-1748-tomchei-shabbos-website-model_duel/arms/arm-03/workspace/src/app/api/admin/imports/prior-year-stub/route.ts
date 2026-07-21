import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { seedImportedPriorYearOrder } from "@/lib/ops/prior-year-stub";

/** Dev/test hook for P10 S3 — creates an imported prior-year order stub. */
export async function POST() {
  try {
    await requirePermission("settings.write");
    const result = await seedImportedPriorYearOrder();
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
