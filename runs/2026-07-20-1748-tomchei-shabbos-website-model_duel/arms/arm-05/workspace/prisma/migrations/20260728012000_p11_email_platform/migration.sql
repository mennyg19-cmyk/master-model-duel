CREATE TYPE "EmailCampaignStatus" AS ENUM ('DRAFT', 'SENT');
CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

CREATE TABLE "EmailList" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailListMember" (
  "id" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "subscriberId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailListMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "branding" JSONB NOT NULL DEFAULT '{}',
  "isTransactional" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "EmailCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "listId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailCampaignDelivery" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "subscriberId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailCampaignDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailOutbox" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "status" "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailLog" (
  "id" TEXT NOT NULL,
  "outboxId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailList_name_key" ON "EmailList"("name");
CREATE UNIQUE INDEX "EmailListMember_listId_subscriberId_key" ON "EmailListMember"("listId", "subscriberId");
CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");
CREATE UNIQUE INDEX "EmailCampaignDelivery_campaignId_subscriberId_key" ON "EmailCampaignDelivery"("campaignId", "subscriberId");
CREATE UNIQUE INDEX "EmailOutbox_dedupeKey_key" ON "EmailOutbox"("dedupeKey");
CREATE INDEX "EmailCampaign_status_createdAt_idx" ON "EmailCampaign"("status", "createdAt");
CREATE INDEX "EmailOutbox_status_availableAt_idx" ON "EmailOutbox"("status", "availableAt");
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

ALTER TABLE "EmailListMember" ADD CONSTRAINT "EmailListMember_listId_fkey"
  FOREIGN KEY ("listId") REFERENCES "EmailList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailListMember" ADD CONSTRAINT "EmailListMember_subscriberId_fkey"
  FOREIGN KEY ("subscriberId") REFERENCES "NewsletterSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_listId_fkey"
  FOREIGN KEY ("listId") REFERENCES "EmailList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailCampaignDelivery" ADD CONSTRAINT "EmailCampaignDelivery_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailCampaignDelivery" ADD CONSTRAINT "EmailCampaignDelivery_subscriberId_fkey"
  FOREIGN KEY ("subscriberId") REFERENCES "NewsletterSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_outboxId_fkey"
  FOREIGN KEY ("outboxId") REFERENCES "EmailOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
