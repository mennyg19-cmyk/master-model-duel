CREATE TYPE "DeliveryRouteStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "DeliveryStopStatus" AS ENUM ('PENDING', 'DELIVERED');

ALTER TABLE "Package"
ADD COLUMN "pickupLocationId" TEXT,
ADD COLUMN "pickupReadyAt" TIMESTAMP(3),
ADD COLUMN "pickupReadyNotifiedAt" TIMESTAMP(3),
ADD COLUMN "pickupExpiresAt" TIMESTAMP(3),
ADD COLUMN "bulkDeliveryStart" TIMESTAMP(3),
ADD COLUMN "bulkDeliveryEnd" TIMESTAMP(3);

CREATE TABLE "DeliveryRoute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DeliveryRouteStatus" NOT NULL DEFAULT 'PLANNED',
    "assignedDriverId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "printRevision" INTEGER NOT NULL DEFAULT 1,
    "dayOfNotificationsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "status" "DeliveryStopStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverMagicLink" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverMagicLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverDeliveryAudit" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverDeliveryAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationCapture" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageId" TEXT,
    "channel" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationCapture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryRoute_status_createdAt_idx" ON "DeliveryRoute"("status", "createdAt");
CREATE INDEX "DeliveryRoute_assignedDriverId_status_idx" ON "DeliveryRoute"("assignedDriverId", "status");
CREATE UNIQUE INDEX "DeliveryStop_packageId_key" ON "DeliveryStop"("packageId");
CREATE UNIQUE INDEX "DeliveryStop_routeId_sequence_key" ON "DeliveryStop"("routeId", "sequence");
CREATE INDEX "DeliveryStop_routeId_status_sequence_idx" ON "DeliveryStop"("routeId", "status", "sequence");
CREATE UNIQUE INDEX "DriverMagicLink_tokenHash_key" ON "DriverMagicLink"("tokenHash");
CREATE INDEX "DriverMagicLink_routeId_expiresAt_idx" ON "DriverMagicLink"("routeId", "expiresAt");
CREATE INDEX "DriverDeliveryAudit_routeId_deliveredAt_idx" ON "DriverDeliveryAudit"("routeId", "deliveredAt");
CREATE INDEX "DriverDeliveryAudit_linkId_deliveredAt_idx" ON "DriverDeliveryAudit"("linkId", "deliveredAt");
CREATE UNIQUE INDEX "NotificationCapture_eventKey_channel_key" ON "NotificationCapture"("eventKey", "channel");
CREATE INDEX "NotificationCapture_customerId_sentAt_idx" ON "NotificationCapture"("customerId", "sentAt");
CREATE INDEX "NotificationCapture_packageId_sentAt_idx" ON "NotificationCapture"("packageId", "sentAt");

ALTER TABLE "Package" ADD CONSTRAINT "Package_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "PickupLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverMagicLink" ADD CONSTRAINT "DriverMagicLink_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverDeliveryAudit" ADD CONSTRAINT "DriverDeliveryAudit_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverDeliveryAudit" ADD CONSTRAINT "DriverDeliveryAudit_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "DriverMagicLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationCapture" ADD CONSTRAINT "NotificationCapture_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
