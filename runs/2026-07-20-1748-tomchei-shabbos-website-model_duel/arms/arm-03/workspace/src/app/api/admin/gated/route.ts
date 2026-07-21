import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";

export async function GET() {
  try {
    await requirePermission("staff.manage");
    return NextResponse.json({ ok: true, page: "gated" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
