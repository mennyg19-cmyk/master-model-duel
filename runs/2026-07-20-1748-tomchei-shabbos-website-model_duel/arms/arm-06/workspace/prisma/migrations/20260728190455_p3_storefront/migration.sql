-- AlterTable: seasonId lands nullable, backfills to the earliest season, then
-- goes NOT NULL (a products table with rows but zero seasons cannot exist in
-- practice — the seed always creates the season first).
ALTER TABLE "products" ADD COLUMN     "category" TEXT,
ADD COLUMN     "seasonId" TEXT;

UPDATE "products" SET "seasonId" = (SELECT "id" FROM "seasons" ORDER BY "createdAt" ASC LIMIT 1) WHERE "seasonId" IS NULL;

ALTER TABLE "products" ALTER COLUMN "seasonId" SET NOT NULL;

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "prefNewProducts" BOOLEAN NOT NULL DEFAULT true,
    "prefReminders" BOOLEAN NOT NULL DEFAULT true,
    "prefCommunity" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "driver" TEXT NOT NULL,
    "productId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storedName_key" ON "media_assets"("storedName");

-- CreateIndex
CREATE INDEX "media_assets_productId_idx" ON "media_assets"("productId");

-- CreateIndex
CREATE INDEX "products_seasonId_active_idx" ON "products"("seasonId", "active");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
