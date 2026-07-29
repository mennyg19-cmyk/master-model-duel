-- P9 fix pass:
-- 1. M4: route_stops.packageId RESTRICT -> CASCADE so an ever-routed package
--    can be deleted (regroup absorb / season cleanup) instead of FK-blocking
--    with no staff recovery.
-- 2. M1: driver_route_links.pinLockCount — lifetime PIN lock counter for
--    escalating lockouts across the 72h link lifetime.

ALTER TABLE "route_stops" DROP CONSTRAINT "route_stops_packageId_fkey";
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "driver_route_links" ADD COLUMN "pinLockCount" INTEGER NOT NULL DEFAULT 0;
