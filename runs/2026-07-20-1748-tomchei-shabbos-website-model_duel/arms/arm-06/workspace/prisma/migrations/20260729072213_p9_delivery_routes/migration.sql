-- CreateEnum
CREATE TYPE "DeliveryRouteStatus" AS ENUM ('PLANNED', 'STARTED', 'COMPLETED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "lastPaymentReminderAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "pickupExpiredNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "pickupReadyAt" TIMESTAMP(3),
ADD COLUMN     "pickupReadyNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "delivery_routes" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deliveryDay" TEXT,
    "status" "DeliveryRouteStatus" NOT NULL DEFAULT 'PLANNED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "packageId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "deliveredAt" TIMESTAMP(3),
    "dayOfNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_route_links" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "pinFailures" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_route_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_events" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "stopId" TEXT,
    "linkId" TEXT,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "orderId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_delivery_schedules" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "deliveryDay" TEXT NOT NULL,
    "window" TEXT,
    "packageCount" INTEGER NOT NULL DEFAULT 0,
    "customerCount" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_delivery_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_delivery_schedule_items" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "bulk_delivery_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_routes_seasonId_status_createdAt_idx" ON "delivery_routes"("seasonId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "route_stops_packageId_idx" ON "route_stops"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_routeId_packageId_key" ON "route_stops"("routeId", "packageId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_route_links_routeId_key" ON "driver_route_links"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_route_links_tokenHash_key" ON "driver_route_links"("tokenHash");

-- CreateIndex
CREATE INDEX "route_events_routeId_createdAt_idx" ON "route_events"("routeId", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_messages_kind_channel_createdAt_idx" ON "outbox_messages"("kind", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "bulk_delivery_schedules_seasonId_createdAt_idx" ON "bulk_delivery_schedules"("seasonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_delivery_schedule_items_scheduleId_packageId_key" ON "bulk_delivery_schedule_items"("scheduleId", "packageId");

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "delivery_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_route_links" ADD CONSTRAINT "driver_route_links_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "delivery_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_events" ADD CONSTRAINT "route_events_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "delivery_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_delivery_schedules" ADD CONSTRAINT "bulk_delivery_schedules_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_delivery_schedule_items" ADD CONSTRAINT "bulk_delivery_schedule_items_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "bulk_delivery_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_delivery_schedule_items" ADD CONSTRAINT "bulk_delivery_schedule_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
