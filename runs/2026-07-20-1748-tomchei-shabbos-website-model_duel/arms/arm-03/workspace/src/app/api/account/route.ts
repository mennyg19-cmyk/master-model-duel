import { NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";
import { apiErrorResponse } from "@/lib/api-error";
import { AuthError, getAuthIdentity } from "@/lib/auth";
import { db } from "@/lib/db";
import { listAddresses } from "@/lib/address/book";
import { resolveCustomerId } from "@/lib/orders/draft-access";
import { draftSubtotalCents } from "@/lib/orders/totals";

export async function GET() {
  try {
    const identity = await getAuthIdentity();
    if (!identity) throw new AuthError(401, "Sign in required");
    const customerId = await resolveCustomerId();
    if (!customerId) throw new AuthError(401, "Customer profile required");

    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const addresses = await listAddresses(customerId);
    const drafts = await db.order.findMany({
      where: { customerId, status: OrderStatus.DRAFT },
      include: {
        lines: { include: { addOns: true } },
        season: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    const history = await db.order.findMany({
      where: {
        customerId,
        status: { notIn: [OrderStatus.DRAFT, OrderStatus.DISCARDED] },
      },
      include: { season: true, lines: true },
      orderBy: { placedAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      ok: true,
      profile: {
        id: customer.id,
        displayName: customer.displayName,
        email: customer.email,
        phone: customer.phone,
      },
      addresses,
      drafts: drafts.map((d) => ({
        id: d.id,
        draftRef: d.draftRef,
        seasonName: d.season.name,
        lineCount: d.lines.length,
        subtotalCents: draftSubtotalCents(d.lines),
        updatedAt: d.updatedAt,
      })),
      orders: history.map((o) => ({
        id: o.id,
        draftRef: o.draftRef,
        orderNumber: o.orderNumber,
        status: o.status,
        seasonName: o.season.name,
        lineCount: o.lines.length,
        placedAt: o.placedAt,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
