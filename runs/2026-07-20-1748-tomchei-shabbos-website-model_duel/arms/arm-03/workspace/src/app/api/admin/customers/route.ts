import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import {
  findOrCreateCustomer,
  listCustomers,
  searchCustomersForPos,
} from "@/lib/ops/customers";

export async function GET(request: Request) {
  try {
    await requirePermission("admin.access");
    const url = new URL(request.url);
    if (url.searchParams.get("pos") === "1") {
      const q = url.searchParams.get("q") ?? "";
      const customers = await searchCustomersForPos(q);
      return NextResponse.json({ ok: true, customers });
    }
    const result = await listCustomers({
      q: url.searchParams.get("q") ?? undefined,
      page: Number(url.searchParams.get("page") ?? "1"),
      pageSize: Number(url.searchParams.get("pageSize") ?? "50"),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const createSchema = z.object({
  displayName: z.string().min(1).max(200),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const body = createSchema.parse(await request.json());
    const result = await findOrCreateCustomer({
      ...body,
      staffId: staff.effectiveStaff.id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
