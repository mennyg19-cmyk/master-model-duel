CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS');
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'CAPTURED', 'FAILED');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');

CREATE TABLE "EmailList" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "preferenceField" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "htmlBody" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "htmlBody" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "emailListId" TEXT NOT NULL,
  "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL,
  "testSentAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageOutbox" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "channel" "MessageChannel" NOT NULL,
  "eventKey" TEXT NOT NULL,
  "templateKey" TEXT,
  "recipient" TEXT NOT NULL,
  "subject" TEXT,
  "htmlBody" TEXT,
  "textBody" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "customerId" TEXT,
  "orderId" TEXT,
  "packageId" TEXT,
  "campaignId" TEXT,
  "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageAttempt" (
  "id" TEXT NOT NULL,
  "outboxId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "MessageStatus" NOT NULL,
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailList_key_key" ON "EmailList"("key");
CREATE UNIQUE INDEX "EmailList_preferenceField_key" ON "EmailList"("preferenceField");
CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");
CREATE INDEX "EmailCampaign_status_createdAt_idx" ON "EmailCampaign"("status", "createdAt");
CREATE UNIQUE INDEX "MessageOutbox_idempotencyKey_key" ON "MessageOutbox"("idempotencyKey");
CREATE INDEX "MessageOutbox_status_nextAttemptAt_idx" ON "MessageOutbox"("status", "nextAttemptAt");
CREATE INDEX "MessageOutbox_campaignId_status_idx" ON "MessageOutbox"("campaignId", "status");
CREATE INDEX "MessageOutbox_customerId_createdAt_idx" ON "MessageOutbox"("customerId", "createdAt");
CREATE INDEX "MessageOutbox_orderId_createdAt_idx" ON "MessageOutbox"("orderId", "createdAt");
CREATE UNIQUE INDEX "MessageAttempt_outboxId_attemptNumber_key" ON "MessageAttempt"("outboxId", "attemptNumber");
CREATE INDEX "MessageAttempt_status_attemptedAt_idx" ON "MessageAttempt"("status", "attemptedAt");

ALTER TABLE "EmailCampaign"
  ADD CONSTRAINT "EmailCampaign_emailListId_fkey"
  FOREIGN KEY ("emailListId") REFERENCES "EmailList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageOutbox"
  ADD CONSTRAINT "MessageOutbox_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageAttempt"
  ADD CONSTRAINT "MessageAttempt_outboxId_fkey"
  FOREIGN KEY ("outboxId") REFERENCES "MessageOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
