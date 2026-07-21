import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { requireCronBearer } from "@/lib/cron/auth";
import { applyScheduledSeasonFlips } from "@/lib/seasons/manage";

async function runFlip(request: Request) {
  requireCronBearer(request);
  const result = await applyScheduledSeasonFlips();
  return NextResponse.json({ ok: true, ...result });
}

/** Vercel Cron invokes GET; smoke/manual use POST. */
export async function GET(request: Request) {
  try {
    return await runFlip(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return await runFlip(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
