import { NextResponse } from "next/server";
import { CachedPaymentStatus, OrderStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { listOrders } from "@/lib/ops/orders";

export async function GET(request: Request) {
  try {
    await requirePermission("admin.access");
    const url = new URL(request.url);
    const statusRaw = url.searchParams.get("status");
    const payRaw = url.searchParams.get("paymentStatus");
    const result = await listOrders({
      q: url.searchParams.get("q") ?? undefined,
      status:
        statusRaw && Object.values(OrderStatus).includes(statusRaw as OrderStatus)
          ? (statusRaw as OrderStatus)
          : undefined,
      paymentStatus:
        payRaw && Object.values(CachedPaymentStatus).includes(payRaw as CachedPaymentStatus)
          ? (payRaw as CachedPaymentStatus)
          : undefined,
      seasonId: url.searchParams.get("seasonId") ?? undefined,
      page: Number(url.searchParams.get("page") ?? "1"),
      pageSize: Number(url.searchParams.get("pageSize") ?? "50"),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
