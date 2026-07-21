-- P7 fix pass: season-scope print batches (cross-season artifact leak).
-- AlterTable: add nullable, backfill existing rows to the open (else newest) season, then lock down.
ALTER TABLE "PrintBatch" ADD COLUMN "seasonId" TEXT;

UPDATE "PrintBatch" SET "seasonId" = COALESCE(
    (SELECT "id" FROM "Season" WHERE "status" = 'OPEN' ORDER BY "createdAt" DESC LIMIT 1),
    (SELECT "id" FROM "Season" ORDER BY "createdAt" DESC LIMIT 1)
);

ALTER TABLE "PrintBatch" ALTER COLUMN "seasonId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "PrintBatch_seasonId_createdAt_idx" ON "PrintBatch"("seasonId", "createdAt");

-- AddForeignKey
ALTER TABLE "PrintBatch" ADD CONSTRAINT "PrintBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
