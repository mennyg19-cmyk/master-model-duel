-- CreateEnum
CREATE TYPE "FulfillmentChoice" AS ENUM ('PICKUP', 'BULK_DELIVERY', 'PER_PACKAGE_DELIVERY');

-- AlterTable: the zod schema already validates the enum on every write, so
-- existing values all cast cleanly; the column now refuses stray values at
-- the database level too (type/schema drift closed).
ALTER TABLE "draft_recipients" ALTER COLUMN "fulfillmentChoice" TYPE "FulfillmentChoice" USING "fulfillmentChoice"::"FulfillmentChoice";
