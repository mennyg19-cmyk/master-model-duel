-- CreateEnum
CREATE TYPE "MediaStorage" AS ENUM ('VERCEL_BLOB', 'LOCAL');

-- CreateEnum
CREATE TYPE "NewsletterStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "category" TEXT,
ADD COLUMN     "imageAssetId" TEXT;

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "storage" "MediaStorage" NOT NULL,
    "pathname" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "altText" TEXT NOT NULL,
    "uploadedByStaffUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "status" "NewsletterStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "wantsSeasonAnnouncements" BOOLEAN NOT NULL DEFAULT true,
    "wantsOrderReminders" BOOLEAN NOT NULL DEFAULT true,
    "wantsImpactStories" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_pathname_key" ON "MediaAsset"("pathname");

-- CreateIndex
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_normalizedEmail_key" ON "NewsletterSubscriber"("normalizedEmail");

-- CreateIndex
CREATE INDEX "NewsletterSubscriber_status_idx" ON "NewsletterSubscriber"("status");

-- CreateIndex
CREATE INDEX "Product_seasonId_category_idx" ON "Product"("seasonId", "category");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedByStaffUserId_fkey" FOREIGN KEY ("uploadedByStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
