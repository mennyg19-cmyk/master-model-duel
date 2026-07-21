-- P9: delivery routes, magic links, pickup, bulk, notifications

CREATE TYPE "DeliveryRouteStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "RouteStopStatus" AS ENUM ('PENDING', 'DELIVERED', 'SKIPPED');
CREATE TYPE "NotifyChannel" AS ENUM ('EMAIL', 'SMS');
CREATE TYPE "NotifyStatus" AS ENUM ('CAPTURED', 'SENT');

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROUTE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROUTE_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROUTE_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROUTE_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROUTE_REASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DRIVER_DELIVERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'METHOD_SWITCHED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REROUTE_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PICKUP_READY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PICKUP_STAMPED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BULK_DELIVERY_SCHEDULED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_CAPTURED';

ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "geocodedAt" TIMESTAMP(3);
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "pickupReadyAt" TIMESTAMP(3);
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "pickupReadyNotifiedAt" TIMESTAMP(3);
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "pickedUpAt" TIMESTAMP(3);
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "pickupExpiresAt" TIMESTAMP(3);
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "bulkWindowId" TEXT;

CREATE TABLE "DeliveryRoute" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DeliveryRouteStatus" NOT NULL DEFAULT 'DRAFT',
    "driverStaffId" TEXT,
    "createdById" TEXT,
    "pinHash" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "graceExpiresAt" TIMESTAMP(3),
    "dayOfNotifiedAt" TIMESTAMP(3),
    "printPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "RouteStopStatus" NOT NULL DEFAULT 'PENDING',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "recipientName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "mapsUrl" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverMagicLink" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pinRequired" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "graceExpiresAt" TIMESTAMP(3),
    "pinFailCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverMagicLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverDeliveryEvent" (
    "id" TEXT NOT NULL,
    "magicLinkId" TEXT NOT NULL,
    "routeStopId" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "DriverDeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "channel" "NotifyChannel" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotifyStatus" NOT NULL DEFAULT 'CAPTURED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkDeliveryWindow" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "windowLabel" TEXT,
    "scheduledById" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkDeliveryWindow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteStop_packageId_key" ON "RouteStop"("packageId");
CREATE INDEX "RouteStop_routeId_sequence_idx" ON "RouteStop"("routeId", "sequence");
CREATE INDEX "RouteStop_status_idx" ON "RouteStop"("status");
CREATE UNIQUE INDEX "DriverMagicLink_tokenHash_key" ON "DriverMagicLink"("tokenHash");
CREATE INDEX "DriverMagicLink_routeId_idx" ON "DriverMagicLink"("routeId");
CREATE INDEX "DriverDeliveryEvent_magicLinkId_createdAt_idx" ON "DriverDeliveryEvent"("magicLinkId", "createdAt");
CREATE INDEX "DriverDeliveryEvent_routeStopId_idx" ON "DriverDeliveryEvent"("routeStopId");
CREATE UNIQUE INDEX "NotificationOutbox_idempotencyKey_key" ON "NotificationOutbox"("idempotencyKey");
CREATE INDEX "NotificationOutbox_templateKey_createdAt_idx" ON "NotificationOutbox"("templateKey", "createdAt");
CREATE INDEX "NotificationOutbox_recipientKey_idx" ON "NotificationOutbox"("recipientKey");
CREATE INDEX "DeliveryRoute_seasonId_status_idx" ON "DeliveryRoute"("seasonId", "status");
CREATE INDEX "DeliveryRoute_driverStaffId_idx" ON "DeliveryRoute"("driverStaffId");
CREATE INDEX "BulkDeliveryWindow_seasonId_deliveryDate_idx" ON "BulkDeliveryWindow"("seasonId", "deliveryDate");
CREATE INDEX "Package_pickupReadyAt_idx" ON "Package"("pickupReadyAt");
CREATE INDEX "Package_bulkWindowId_idx" ON "Package"("bulkWindowId");

ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_driverStaffId_fkey" FOREIGN KEY ("driverStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverMagicLink" ADD CONSTRAINT "DriverMagicLink_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverDeliveryEvent" ADD CONSTRAINT "DriverDeliveryEvent_magicLinkId_fkey" FOREIGN KEY ("magicLinkId") REFERENCES "DriverMagicLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverDeliveryEvent" ADD CONSTRAINT "DriverDeliveryEvent_routeStopId_fkey" FOREIGN KEY ("routeStopId") REFERENCES "RouteStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BulkDeliveryWindow" ADD CONSTRAINT "BulkDeliveryWindow_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BulkDeliveryWindow" ADD CONSTRAINT "BulkDeliveryWindow_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Package" ADD CONSTRAINT "Package_bulkWindowId_fkey" FOREIGN KEY ("bulkWindowId") REFERENCES "BulkDeliveryWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
