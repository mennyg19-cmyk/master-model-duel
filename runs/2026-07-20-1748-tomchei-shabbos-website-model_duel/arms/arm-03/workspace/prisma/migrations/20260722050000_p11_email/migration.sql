-- P11: email & notification platform

ALTER TYPE "NotifyStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "NotifyStatus" ADD VALUE IF NOT EXISTS 'CLAIMED';
ALTER TYPE "NotifyStatus" ADD VALUE IF NOT EXISTS 'FAILED';

CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENT');

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_CAMPAIGN_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_TEST_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_LOG_PURGED';

ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "claimedBy" TEXT;
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "emailLogId" TEXT;
ALTER TABLE "NotificationOutbox" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_claimedAt_idx" ON "NotificationOutbox"("claimedAt");

CREATE TABLE "MailingList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailingList_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailingList_name_key" ON "MailingList"("name");

CREATE TABLE "MailingListMember" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailingListMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailingListMember_listId_subscriberId_key" ON "MailingListMember"("listId", "subscriberId");
CREATE INDEX "MailingListMember_subscriberId_idx" ON "MailingListMember"("subscriberId");

ALTER TABLE "MailingListMember" ADD CONSTRAINT "MailingListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MailingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailingListMember" ADD CONSTRAINT "MailingListMember_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "NewsletterSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmailCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "listId" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailCampaign_status_createdAt_idx" ON "EmailCampaign"("status", "createdAt");
CREATE INDEX "EmailCampaign_listId_idx" ON "EmailCampaign"("listId");

ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MailingList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EmailCampaignDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outboxId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailCampaignDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailCampaignDelivery_idempotencyKey_key" ON "EmailCampaignDelivery"("idempotencyKey");
CREATE UNIQUE INDEX "EmailCampaignDelivery_campaignId_recipientKey_key" ON "EmailCampaignDelivery"("campaignId", "recipientKey");
CREATE INDEX "EmailCampaignDelivery_campaignId_idx" ON "EmailCampaignDelivery"("campaignId");

ALTER TABLE "EmailCampaignDelivery" ADD CONSTRAINT "EmailCampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "branding" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");

CREATE TABLE "TriggeredEmailOverride" (
    "key" TEXT NOT NULL,
    "subject" TEXT,
    "htmlBody" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TriggeredEmailOverride_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "channel" "NotifyChannel" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "outboxId" TEXT,
    "campaignId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAfter" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailLog_purgeAfter_createdAt_idx" ON "EmailLog"("purgeAfter", "createdAt");
CREATE INDEX "EmailLog_outboxId_idx" ON "EmailLog"("outboxId");
CREATE INDEX "EmailLog_templateKey_createdAt_idx" ON "EmailLog"("templateKey", "createdAt");

CREATE TABLE "CronJobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "claimedToken" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "meta" JSONB,
    CONSTRAINT "CronJobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CronJobRun_claimedToken_key" ON "CronJobRun"("claimedToken");
CREATE INDEX "CronJobRun_jobKey_startedAt_idx" ON "CronJobRun"("jobKey", "startedAt");
