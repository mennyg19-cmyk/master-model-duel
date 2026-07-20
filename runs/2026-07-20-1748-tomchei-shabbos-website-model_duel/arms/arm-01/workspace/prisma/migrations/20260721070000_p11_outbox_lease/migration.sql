ALTER TABLE "MessageOutbox" ADD COLUMN "lockedUntil" TIMESTAMP(3);

CREATE INDEX "MessageOutbox_status_lockedUntil_idx"
  ON "MessageOutbox"("status", "lockedUntil");
