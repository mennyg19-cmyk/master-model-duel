CREATE TYPE "AddressReviewStatus" AS ENUM ('PENDING', 'APPROVED');

ALTER TABLE "Address"
  ADD COLUMN "reviewStatus" "AddressReviewStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "Address_reviewStatus_idx" ON "Address"("reviewStatus");
