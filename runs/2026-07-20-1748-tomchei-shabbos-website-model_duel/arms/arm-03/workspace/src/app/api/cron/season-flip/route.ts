import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { requireCronBearer } from "@/lib/cron/auth";
import { applyScheduledSeasonFlips } from "@/lib/seasons/manage";

export async function POST(request: Request) {
  try {
    requireCronBearer(request);
    const result = await applyScheduledSeasonFlips();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
