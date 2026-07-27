ALTER TABLE "NewsletterSubscriber"
  ADD COLUMN "confirmationTokenHash" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3);
