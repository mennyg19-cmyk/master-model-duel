import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { requireCronBearer } from "@/lib/cron/auth";
import { runPickupExpiryCron } from "@/lib/pickup/bulk";

export async function POST(request: Request) {
  try {
    requireCronBearer(request);
    const result = await runPickupExpiryCron();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
