import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCustomerDetail } from "@/lib/ops/customers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("admin.access");
    const { id } = await ctx.params;
    const customer = await getCustomerDetail(id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "Customer not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, customer });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
