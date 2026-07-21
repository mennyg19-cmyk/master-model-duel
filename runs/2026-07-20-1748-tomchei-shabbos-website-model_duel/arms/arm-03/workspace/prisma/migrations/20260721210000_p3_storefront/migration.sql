-- AlterEnum (IF NOT EXISTS for re-run safety)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PRODUCT_UPSERTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADDON_UPSERTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEDIA_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEDIA_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NEWSLETTER_SUBSCRIBED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NEWSLETTER_UNSUBSCRIBED';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "primaryImageUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "mediaAssetId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MediaAsset" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "altText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNorm" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MediaAsset_pathname_key" ON "MediaAsset"("pathname");
CREATE INDEX IF NOT EXISTS "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscriber_emailNorm_key" ON "NewsletterSubscriber"("emailNorm");
CREATE INDEX IF NOT EXISTS "NewsletterSubscriber_unsubscribedAt_idx" ON "NewsletterSubscriber"("unsubscribedAt");
CREATE INDEX IF NOT EXISTS "Product_seasonId_category_idx" ON "Product"("seasonId", "category");

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_mediaAssetId_fkey"
    FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
