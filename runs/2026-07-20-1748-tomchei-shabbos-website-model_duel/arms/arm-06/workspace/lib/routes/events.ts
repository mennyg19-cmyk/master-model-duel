import { Prisma } from "@prisma/client";

// RouteEvent action vocabulary (mirrors PackageEventAction's discipline in
// lib/packages/stages.ts). G-025's driver audit — timestamp + link id on
// every Delivered tap — lands as stop_delivered rows.
export type RouteEventAction =
  | "route_created"
  | "route_started"
  | "stop_delivered"
  | "route_completed"
  | "stop_reassigned_out"
  | "stop_reassigned_in"
  | "stop_added_reroute"
  | "link_created"
  | "link_rotated";

export async function writeRouteEvent(
  tx: Prisma.TransactionClient,
  routeId: string,
  action: RouteEventAction,
  extras: {
    stopId?: string | null;
    linkId?: string | null;
    actorId?: string | null;
    metadata?: Prisma.InputJsonValue;
  } = {},
): Promise<void> {
  await tx.routeEvent.create({
    data: {
      routeId,
      action,
      stopId: extras.stopId ?? null,
      linkId: extras.linkId ?? null,
      actorId: extras.actorId ?? null,
      metadata: extras.metadata ?? Prisma.DbNull,
    },
  });
}
