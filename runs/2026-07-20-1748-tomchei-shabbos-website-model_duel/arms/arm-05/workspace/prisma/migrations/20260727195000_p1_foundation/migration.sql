CREATE TYPE "StaffRole" AS ENUM ('MANAGER', 'STAFF', 'DRIVER');
CREATE TYPE "PermissionEffect" AS ENUM ('GRANT', 'DENY');

CREATE TABLE "StaffUser" (
  "id" TEXT NOT NULL,
  "clerkUserId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "role" "StaffRole" NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PermissionOverride" (
  "id" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "effect" "PermissionEffect" NOT NULL,
  CONSTRAINT "PermissionOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerIdentity" (
  "id" TEXT NOT NULL,
  "clerkUserId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "subjectId" TEXT,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionLoginStamp" (
  "id" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionLoginStamp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "StaffUser_clerkUserId_key" ON "StaffUser"("clerkUserId");
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");
CREATE UNIQUE INDEX "PermissionOverride_staffId_permission_key" ON "PermissionOverride"("staffId", "permission");
CREATE UNIQUE INDEX "CustomerIdentity_clerkUserId_key" ON "CustomerIdentity"("clerkUserId");
CREATE UNIQUE INDEX "CustomerIdentity_email_key" ON "CustomerIdentity"("email");
CREATE UNIQUE INDEX "SessionLoginStamp_sessionId_key" ON "SessionLoginStamp"("sessionId");

ALTER TABLE "PermissionOverride" ADD CONSTRAINT "PermissionOverride_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionLoginStamp" ADD CONSTRAINT "SessionLoginStamp_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
