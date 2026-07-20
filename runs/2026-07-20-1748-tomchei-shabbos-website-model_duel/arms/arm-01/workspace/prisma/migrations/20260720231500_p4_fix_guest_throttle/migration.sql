CREATE TABLE "GuestDraftThrottle" (
    "key" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestDraftThrottle_pkey" PRIMARY KEY ("key")
);
