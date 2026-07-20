-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('MANAGER', 'STAFF', 'DRIVER');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'INVITED',
    "grantPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "denyPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAccount" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffInvite" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BootstrapState" (
    "key" TEXT NOT NULL,
    "managerStaffId" TEXT NOT NULL,
    "managerClerkId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BootstrapState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "impersonatorId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "actorStaffId" TEXT NOT NULL,
    "targetStaffId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionStamp" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "clerkSessionId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,

    CONSTRAINT "SessionStamp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_clerkUserId_key" ON "StaffUser"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE INDEX "StaffUser_status_role_idx" ON "StaffUser"("status", "role");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_clerkUserId_key" ON "CustomerAccount"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BootstrapState_managerClerkId_key" ON "BootstrapState"("managerClerkId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_occurredAt_idx" ON "AuditLog"("targetType", "targetId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorStaffId_occurredAt_idx" ON "AuditLog"("actorStaffId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionStamp_clerkSessionId_key" ON "SessionStamp"("clerkSessionId");

-- CreateIndex
CREATE INDEX "SessionStamp_staffUserId_lastSeenAt_idx" ON "SessionStamp"("staffUserId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStamp" ADD CONSTRAINT "SessionStamp_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
