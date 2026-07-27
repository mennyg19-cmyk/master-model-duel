CREATE TYPE "DeliveryRouteStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED');

ALTER TABLE "Package"
  ADD COLUMN "pickupReadyAt" TIMESTAMP(3),
  ADD COLUMN "pickupExpiresAt" TIMESTAMP(3);

CREATE TABLE "DeliveryRoute" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "DeliveryRouteStatus" NOT NULL DEFAULT 'DRAFT',
  "driverId" TEXT,
  "createdById" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryRouteStop" (
  "id" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryRouteStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverRouteLink" (
  "id" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "pinHash" TEXT,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "throttledUntil" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverRouteLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryNotification" (
  "id" TEXT NOT NULL,
  "packageId" TEXT,
  "customerId" TEXT,
  "event" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkDeliverySchedule" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "scheduledById" TEXT NOT NULL,
  "deliveryDate" TIMESTAMP(3) NOT NULL,
  "window" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BulkDeliverySchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryRouteStop_packageId_key" ON "DeliveryRouteStop"("packageId");
CREATE UNIQUE INDEX "DeliveryRouteStop_routeId_sequence_key" ON "DeliveryRouteStop"("routeId", "sequence");
CREATE UNIQUE INDEX "DriverRouteLink_tokenHash_key" ON "DriverRouteLink"("tokenHash");
CREATE UNIQUE INDEX "DeliveryNotification_dedupeKey_key" ON "DeliveryNotification"("dedupeKey");
CREATE INDEX "Package_pickupReadyAt_pickupExpiresAt_idx" ON "Package"("pickupReadyAt", "pickupExpiresAt");
CREATE INDEX "DeliveryRoute_status_driverId_idx" ON "DeliveryRoute"("status", "driverId");
CREATE INDEX "DeliveryRouteStop_routeId_deliveredAt_idx" ON "DeliveryRouteStop"("routeId", "deliveredAt");
CREATE INDEX "DriverRouteLink_routeId_expiresAt_idx" ON "DriverRouteLink"("routeId", "expiresAt");
CREATE INDEX "DeliveryNotification_event_capturedAt_idx" ON "DeliveryNotification"("event", "capturedAt");
CREATE INDEX "BulkDeliverySchedule_deliveryDate_idx" ON "BulkDeliverySchedule"("deliveryDate");

ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryRouteStop" ADD CONSTRAINT "DeliveryRouteStop_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryRouteStop" ADD CONSTRAINT "DeliveryRouteStop_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverRouteLink" ADD CONSTRAINT "DriverRouteLink_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryNotification" ADD CONSTRAINT "DeliveryNotification_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryNotification" ADD CONSTRAINT "DeliveryNotification_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BulkDeliverySchedule" ADD CONSTRAINT "BulkDeliverySchedule_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkDeliverySchedule" ADD CONSTRAINT "BulkDeliverySchedule_scheduledById_fkey"
  FOREIGN KEY ("scheduledById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
