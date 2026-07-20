ALTER TABLE "Product"
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Gifts',
ADD COLUMN "imageUrl" TEXT;

CREATE TABLE "NewsletterSubscriber" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "productUpdates" BOOLEAN NOT NULL DEFAULT true,
  "volunteerStories" BOOLEAN NOT NULL DEFAULT true,
  "communityImpact" BOOLEAN NOT NULL DEFAULT true,
  "isSubscribed" BOOLEAN NOT NULL DEFAULT true,
  "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unsubscribedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "pathname" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsletterSubscriber_email_key"
ON "NewsletterSubscriber"("email");

CREATE UNIQUE INDEX "MediaAsset_pathname_key"
ON "MediaAsset"("pathname");

CREATE INDEX "MediaAsset_createdAt_idx"
ON "MediaAsset"("createdAt");
