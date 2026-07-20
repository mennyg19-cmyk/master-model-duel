import { NextResponse } from "next/server";
import { z } from "zod";
import {
  confirmRouteReroute,
  createDeliveryRoute,
  findNearbyShippingPackages,
  markPickupReady,
  reassignDeliveryRoute,
  scheduleBulkDelivery,
  stampPickup,
  switchFulfillmentMethod,
} from "@/domain/delivery";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getShippingProvider } from "@/lib/shippo";

const deliveryActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-route"),
    name: z.string().min(1),
    packageIds: z.array(z.string().min(1)).min(1),
    assignedDriverId: z.string().min(1).optional(),
    pin: z.string().regex(/^\d{4}$/).optional(),
  }),
  z.object({
    action: z.literal("reassign-route"),
    routeId: z.string().min(1),
    assignedDriverId: z.string().min(1).nullable(),
  }),
  z.object({
    action: z.literal("switch-method"),
    packageId: z.string().min(1),
    fulfillmentMethodId: z.string().min(1),
  }),
  z.object({
    action: z.literal("confirm-reroute"),
    routeId: z.string().min(1),
    packageId: z.string().min(1),
    deliveryMethodId: z.string().min(1),
  }),
  z.object({
    action: z.literal("pickup-ready"),
    packageId: z.string().min(1),
    pickupLocationId: z.string().min(1),
  }),
  z.object({ action: z.literal("pickup-stamp"), packageId: z.string().min(1) }),
  z.object({
    action: z.literal("schedule-bulk"),
    packageId: z.string().min(1),
    start: z.coerce.date(),
    end: z.coerce.date(),
  }),
]);

export async function GET(request: Request) {
  try {
    await requirePermission("orders:manage");
    const routeId = new URL(request.url).searchParams.get("routeId");
    if (!routeId) {
      return NextResponse.json({ error: "Route ID is required." }, { status: 400 });
    }
    return NextResponse.json({
      suggestions: await findNearbyShippingPackages(db, routeId),
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delivery lookup failed." },
      { status: 409 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requirePermission("orders:manage");
    const parsed = deliveryActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Delivery action details are invalid." }, { status: 400 });
    }
    const input = parsed.data;
    if (input.action === "create-route") {
      return NextResponse.json(
        await createDeliveryRoute(db, { ...input, actorStaffId: session.actor.id }),
      );
    }
    if (input.action === "reassign-route") {
      return NextResponse.json(
        await reassignDeliveryRoute(
          db,
          input.routeId,
          input.assignedDriverId,
          session.actor.id,
        ),
      );
    }
    if (input.action === "switch-method") {
      return NextResponse.json(
        await switchFulfillmentMethod(db, getShippingProvider(), {
          ...input,
          actorStaffId: session.actor.id,
        }),
      );
    }
    if (input.action === "confirm-reroute") {
      return NextResponse.json(
        await confirmRouteReroute(db, getShippingProvider(), {
          ...input,
          actorStaffId: session.actor.id,
        }),
      );
    }
    if (input.action === "pickup-ready") {
      return NextResponse.json(
        await markPickupReady(db, input.packageId, input.pickupLocationId),
      );
    }
    if (input.action === "pickup-stamp") {
      return NextResponse.json(
        await stampPickup(db, input.packageId, session.actor.id),
      );
    }
    await scheduleBulkDelivery(db, input.packageId, input.start, input.end);
    return NextResponse.json({ scheduled: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delivery action failed." },
      { status: 409 },
    );
  }
}
