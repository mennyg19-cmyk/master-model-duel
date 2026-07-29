-- AlterTable
ALTER TABLE "email_campaign_recipients" ADD COLUMN     "lastAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "outbox_messages" ADD COLUMN     "campaignRecipientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "outbox_messages_campaignRecipientId_key" ON "outbox_messages"("campaignRecipientId");

-- CreateIndex
CREATE INDEX "outbox_messages_status_lastAttemptAt_idx" ON "outbox_messages"("status", "lastAttemptAt");

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_campaignRecipientId_fkey" FOREIGN KEY ("campaignRecipientId") REFERENCES "email_campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
