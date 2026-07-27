-- CreateEnum
CREATE TYPE "EmailCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');

-- CreateEnum
CREATE TYPE "MessageAttemptOutcome" AS ENUM ('SENT', 'FAILED');

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "providerReference" TEXT;

-- CreateTable
CREATE TABLE "SubscriberList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriberList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriberListMember" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriberListMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByStaffUserId" TEXT,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "EmailCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "listId" TEXT,
    "preferenceKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdByStaffUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCampaignSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCampaignSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" "MessageAttemptOutcome" NOT NULL,
    "providerReference" TEXT,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapturedMessage" (
    "id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapturedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriberList_slug_key" ON "SubscriberList"("slug");

-- CreateIndex
CREATE INDEX "SubscriberListMember_subscriberId_idx" ON "SubscriberListMember"("subscriberId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriberListMember_listId_subscriberId_key" ON "SubscriberListMember"("listId", "subscriberId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");

-- CreateIndex
CREATE INDEX "EmailCampaign_status_createdAt_idx" ON "EmailCampaign"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailCampaignSend_messageId_key" ON "EmailCampaignSend"("messageId");

-- CreateIndex
CREATE INDEX "EmailCampaignSend_subscriberId_idx" ON "EmailCampaignSend"("subscriberId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailCampaignSend_campaignId_subscriberId_key" ON "EmailCampaignSend"("campaignId", "subscriberId");

-- CreateIndex
CREATE INDEX "NotificationAttempt_messageId_idx" ON "NotificationAttempt"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAttempt_messageId_attempt_key" ON "NotificationAttempt"("messageId", "attempt");

-- CreateIndex
CREATE INDEX "CapturedMessage_capturedAt_idx" ON "CapturedMessage"("capturedAt");

-- CreateIndex
CREATE INDEX "NotificationLog_status_nextAttemptAt_idx" ON "NotificationLog"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationLog_status_sentAt_idx" ON "NotificationLog"("status", "sentAt");

-- AddForeignKey
ALTER TABLE "SubscriberListMember" ADD CONSTRAINT "SubscriberListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SubscriberList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriberListMember" ADD CONSTRAINT "SubscriberListMember_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "NewsletterSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SubscriberList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaignSend" ADD CONSTRAINT "EmailCampaignSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaignSend" ADD CONSTRAINT "EmailCampaignSend_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "NewsletterSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaignSend" ADD CONSTRAINT "EmailCampaignSend_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "NotificationLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "NotificationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
