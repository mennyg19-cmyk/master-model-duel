import { NextResponse } from "next/server";
import { z } from "zod";
import { createWalkInPosOrder, listCustomers, listOrders, operationsDashboard } from "@/lib/admin-operations";
import { prisma } from "@/lib/db";
import { authorize, hasSameOrigin } from "@/lib/route-auth";
import { hasStaffPermission } from "@/lib/staff-store";

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pos"), input: z.unknown() }),
  z.object({ action: z.literal("bulk"), orderIds: z.array(z.string().cuid()).min(1).max(100), versions: z.record(z.string(), z.number().int().positive()) }),
]);

export async function GET(request: Request) {
  const authorization = await authorize(request, "orders.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "dashboard";
  if (view === "orders") return NextResponse.json(await listOrders({
    query: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    page: Math.max(1, Number(url.searchParams.get("page") ?? "1")),
  }));
  if (view === "customers") {
    const customers = await listCustomers(url.searchParams.get("q") ?? undefined, Math.max(1, Number(url.searchParams.get("page") ?? "1")));
    return NextResponse.json(customers);
  }
  if (view === "products") {
    return NextResponse.json({ products: await prisma.product.findMany({
      where: { isActive: true, season: { status: "OPEN" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, priceCents: true },
    }) });
  }
  return NextResponse.json(await operationsDashboard());
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "orders.write");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid POS order or bounded bulk action." }, { status: 400 });
  try {
    if (parsed.data.action === "pos") {
      return NextResponse.json({
        payment: await createWalkInPosOrder(
          parsed.data.input,
          authorization.staffMember.id,
          request.url,
          hasStaffPermission(authorization.staffMember, "customers.write"),
        ),
      });
    }
    const bulk = parsed.data;
    if (bulk.orderIds.some((orderId) => bulk.versions[orderId] === undefined)) {
      return NextResponse.json({ error: "Provide a version for every order in the bulk probe." }, { status: 400 });
    }
    const outcomes = await Promise.all(bulk.orderIds.map(async (orderId) => {
      const updated = await prisma.order.updateMany({
        where: { id: orderId, status: "FINALIZED", version: bulk.versions[orderId] },
        data: { version: { increment: 1 } },
      });
      return { orderId, outcome: updated.count === 1 ? "processed" : "conflict" };
    }));
    await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "orders.bulk_version_probed", details: { outcomes } } });
    return NextResponse.json({ outcomes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operation could not be completed." }, { status: 400 });
  }
}
