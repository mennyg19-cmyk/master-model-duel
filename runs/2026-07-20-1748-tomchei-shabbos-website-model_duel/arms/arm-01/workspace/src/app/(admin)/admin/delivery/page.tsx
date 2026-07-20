import { DeliveryOperations } from "@/components/delivery-operations";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ followUp?: string }>;
}) {
  await requirePermission("admin:view");
  const { followUp } = await searchParams;
  const [packages, routes, drivers, methods, pickupLocations, followUps] = await Promise.all([
    db.package.findMany({
      where: { isActive: true, stage: { notIn: ["SENT", "PICKED_UP"] } },
      include: {
        fulfillmentMethod: true,
        deliveryStop: true,
        order: { include: { customer: true } },
      },
      orderBy: { updatedAt: "asc" },
      take: 250,
    }),
    db.deliveryRoute.findMany({
      include: { assignedDriver: true, _count: { select: { stops: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.staffUser.findMany({
      where: { role: "DRIVER", status: "ACTIVE" },
      orderBy: { displayName: "asc" },
    }),
    db.fulfillmentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.pickupLocation.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.order.findMany({
      where:
        followUp === "unpaid"
          ? { cachedPaymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }
          : followUp === "pickup"
            ? { packages: { some: { pickupReadyAt: { not: null }, stage: { not: "PICKED_UP" } } } }
            : { packages: { some: { bulkDeliveryStart: { not: null }, stage: { not: "SENT" } } } },
      include: { customer: true },
      orderBy: { updatedAt: "asc" },
      take: 100,
    }),
  ]);
  const toChoice = (entry: (typeof packages)[number]) => ({
    id: entry.id,
    label: `${entry.recipientName} · Order #${entry.order.orderNumber ?? entry.orderId.slice(-6)}`,
    methodId: entry.fulfillmentMethodId,
    method: entry.fulfillmentMethod.displayName,
    stage: entry.stage,
  });

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Delivery operations</p>
      <h1 className="mt-2 text-4xl font-black">Routes, pickup, and scheduling</h1>
      <p className="mt-2 max-w-3xl text-[var(--muted)]">
        Build Mapbox-geocoded routes, issue scoped driver links, confirm reroutes,
        and run the pickup and bulk-delivery desks.
      </p>
      <div className="mt-8">
        <DeliveryOperations
          deliveryMethods={methods.filter((entry) => !entry.isShipping && !entry.isPickup).map((entry) => ({ id: entry.id, label: entry.displayName }))}
          deliveryPackages={packages.filter((entry) => !entry.fulfillmentMethod.isShipping && !entry.fulfillmentMethod.isPickup && !entry.deliveryStop).map(toChoice)}
          drivers={drivers.map((entry) => ({ id: entry.id, label: entry.displayName }))}
          pickupLocations={pickupLocations.map((entry) => ({ id: entry.id, label: entry.name }))}
          pickupPackages={packages.filter((entry) => entry.fulfillmentMethod.isPickup).map(toChoice)}
          routes={routes.map((entry) => ({
            id: entry.id,
            label: `${entry.name} · ${entry.status} · ${entry._count.stops} stops · ${entry.assignedDriver?.displayName ?? "unassigned"}`,
          }))}
          shippingMethods={methods.filter((entry) => entry.isShipping).map((entry) => ({ id: entry.id, label: entry.displayName }))}
          shippingPackages={packages.filter((entry) => entry.fulfillmentMethod.isShipping).map(toChoice)}
        />
      </div>
      <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">Follow-up call center</h2>
          <div className="flex gap-2 text-sm font-bold">
            <a className="rounded-lg border px-3 py-2" href="?followUp=bulk">Bulk delivery</a>
            <a className="rounded-lg border px-3 py-2" href="?followUp=pickup">Unclaimed pickup</a>
            <a className="rounded-lg border px-3 py-2" href="?followUp=unpaid">Needs payment</a>
          </div>
        </div>
        <div className="mt-4 divide-y divide-[var(--border)]">
          {followUps.map((order) => (
            <div className="flex justify-between gap-4 py-3" key={order.id}>
              <span><b>{order.customer.displayName}</b><br /><small>{order.customer.phone ?? order.customer.email ?? "No contact on file"}</small></span>
              <span>Order #{order.orderNumber ?? order.draftReference}</span>
            </div>
          ))}
          {!followUps.length && <p className="py-6 text-[var(--muted)]">No matching follow-ups.</p>}
        </div>
      </section>
    </div>
  );
}
