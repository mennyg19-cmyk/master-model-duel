import { NextResponse } from "next/server";
import { z } from "zod";
import {
  confirmReroute,
  createRoute,
  listRoutes,
  markPickupReady,
  nearbyShippingPackages,
  pickupDoorList,
  scheduleBulkDelivery,
  stampPickedUp,
  switchPackageMethod,
  unclaimedPickupPackages,
} from "@/lib/delivery";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_route"), name: z.string().trim().min(1).max(100), packageIds: z.array(z.string().cuid()).min(1), driverId: z.string().cuid().optional(), pin: z.string().regex(/^\d{4}$/).optional() }),
  z.object({ action: z.literal("switch_method"), packageId: z.string().cuid(), methodCode: z.enum(["SHIP", "DELIVERY"]) }),
  z.object({ action: z.literal("nearby_shipping"), routeId: z.string().cuid() }),
  z.object({ action: z.literal("confirm_reroute"), routeId: z.string().cuid(), packageId: z.string().cuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("schedule_bulk"), orderId: z.string().cuid(), deliveryDate: z.string().datetime(), window: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("pickup_ready"), packageId: z.string().cuid() }),
  z.object({ action: z.literal("stamp_pickup"), packageId: z.string().cuid(), pickupLocationId: z.string().cuid() }),
]);

export async function GET(request: Request) {
  const authorization = await authorize(request, "orders.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const searchParams = new URL(request.url).searchParams;
  const view = searchParams.get("view");
  const pickupLocationId = searchParams.get("pickupLocationId");
  if ((view === "pickup_door_list" || view === "unclaimed_pickups") && (!pickupLocationId || !z.string().cuid().safeParse(pickupLocationId).success)) {
    return NextResponse.json({ error: "Provide a pickup location for this report." }, { status: 400 });
  }
  return NextResponse.json(view === "pickup_door_list"
    ? { packages: await pickupDoorList(pickupLocationId!) }
    : view === "unclaimed_pickups"
      ? { packages: await unclaimedPickupPackages(pickupLocationId!) }
    : { routes: await listRoutes() });
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "orders.write");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid delivery operation." }, { status: 400 });
  if (parsed.data.action === "confirm_reroute" && authorization.staffMember.role !== "MANAGER") {
    return NextResponse.json({ error: "Only a manager can confirm a map reroute." }, { status: 403 });
  }
  try {
    const action = parsed.data;
    if (action.action === "create_route") return NextResponse.json(await createRoute({ ...action, actorId: authorization.staffMember.id }), { status: 201 });
    if (action.action === "switch_method") return NextResponse.json({ package: await switchPackageMethod(action.packageId, action.methodCode, authorization.staffMember.id) });
    if (action.action === "nearby_shipping") return NextResponse.json({ packages: await nearbyShippingPackages(action.routeId) });
    if (action.action === "confirm_reroute") return NextResponse.json({ stop: await confirmReroute(action.routeId, action.packageId, authorization.staffMember.id) });
    if (action.action === "schedule_bulk") return NextResponse.json({ schedule: await scheduleBulkDelivery(action.orderId, new Date(action.deliveryDate), action.window, authorization.staffMember.id) });
    if (action.action === "pickup_ready") {
      await markPickupReady(action.packageId, authorization.staffMember.id);
      return NextResponse.json({ ready: true });
    }
    await stampPickedUp(action.packageId, action.pickupLocationId, authorization.staffMember.id);
    return NextResponse.json({ pickedUp: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Delivery operation could not be completed." }, { status: 400 });
  }
}
