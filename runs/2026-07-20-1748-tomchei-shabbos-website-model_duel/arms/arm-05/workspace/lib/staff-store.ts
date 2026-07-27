import {
  hasPermission,
  type Permission,
  type PermissionEffect,
  type StaffRole,
} from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export type StaffUser = {
  id: string;
  clerkUserId: string;
  email: string;
  displayName: string;
  role: StaffRole;
  revokedAt: string | null;
  version: number;
  overrides: Partial<Record<Permission, PermissionEffect>>;
};

export type AuditEvent = {
  id: string;
  actorId: string | null;
  action: string;
  subjectId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

const staffWithOverrides = {
  overrides: true,
} satisfies Prisma.StaffUserInclude;

type DatabaseStaff = Prisma.StaffUserGetPayload<{
  include: typeof staffWithOverrides;
}>;

function serializeStaff(staffMember: DatabaseStaff): StaffUser {
  return {
    id: staffMember.id,
    clerkUserId: staffMember.clerkUserId,
    email: staffMember.email,
    displayName: staffMember.displayName,
    role: staffMember.role,
    revokedAt: staffMember.revokedAt?.toISOString() ?? null,
    version: staffMember.version,
    overrides: Object.fromEntries(
      staffMember.overrides.map((override) => [override.permission, override.effect]),
    ) as Partial<Record<Permission, PermissionEffect>>,
  };
}

function toAuditEvent(event: {
  id: string;
  actorId: string | null;
  action: string;
  subjectId: string | null;
  details: Prisma.JsonValue;
  createdAt: Date;
}): AuditEvent {
  return {
    id: event.id,
    actorId: event.actorId,
    action: event.action,
    subjectId: event.subjectId,
    details: typeof event.details === "object" && event.details !== null && !Array.isArray(event.details)
      ? event.details as Record<string, unknown>
      : {},
    createdAt: event.createdAt.toISOString(),
  };
}

export async function createFirstManager(
  clerkUserId: string,
  displayName: string,
  email: string,
) {
  try {
    const manager = await prisma.$transaction(async (transaction) => {
      await transaction.appSetting.create({
        data: { key: "setup.completed", value: { completedAt: new Date().toISOString() } },
      });
      const createdManager = await transaction.staffUser.create({
        data: { clerkUserId, displayName, email, role: "MANAGER" },
        include: staffWithOverrides,
      });
      await transaction.auditEvent.create({
        data: {
          actorId: createdManager.id,
          action: "staff.bootstrap",
          subjectId: createdManager.id,
          details: { email: createdManager.email },
        },
      });
      return createdManager;
    });
    return { ok: true as const, manager: serializeStaff(manager) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, reason: "Setup is locked." };
    }
    throw error;
  }
}

export async function addStaff(
  actorId: string,
  clerkUserId: string,
  displayName: string,
  email: string,
  role: StaffRole,
) {
  try {
    const staffMember = await prisma.staffUser.create({
      data: { clerkUserId, displayName, email, role },
      include: staffWithOverrides,
    });
    await prisma.auditEvent.create({
      data: {
        actorId,
        action: "staff.invited",
        subjectId: staffMember.id,
        details: { email: staffMember.email, role },
      },
    });
    return { ok: true as const, staffMember: serializeStaff(staffMember) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, reason: "A staff account with that Clerk ID or email already exists." };
    }
    throw error;
  }
}

export async function listStaff() {
  return (await prisma.staffUser.findMany({
    include: staffWithOverrides,
    orderBy: { createdAt: "asc" },
  })).map(serializeStaff);
}

export async function listAudits() {
  return (await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
  })).map(toAuditEvent);
}

export async function canBootstrap() {
  return !(await prisma.appSetting.findUnique({ where: { key: "setup.completed" } }));
}

export async function findStaffByClerkUserId(clerkUserId: string) {
  const staffMember = await prisma.staffUser.findUnique({
    where: { clerkUserId },
    include: staffWithOverrides,
  });
  return staffMember ? serializeStaff(staffMember) : null;
}

export async function updateStaff(
  actorId: string,
  staffId: string,
  expectedVersion: number,
  patch: Pick<StaffUser, "role" | "overrides">,
) {
  const outcome = await prisma.staffUser.updateMany({
    where: { id: staffId, version: expectedVersion },
    data: {
      role: patch.role,
      version: { increment: 1 },
    },
  });
  if (outcome.count === 0) {
    const staffMember = await prisma.staffUser.findUnique({ where: { id: staffId } });
    return staffMember
      ? { ok: false as const, status: 409, reason: "This staff record changed. Refresh before saving." }
      : { ok: false as const, status: 404, reason: "Staff account was not found." };
  }
  await prisma.$transaction([
    prisma.permissionOverride.deleteMany({ where: { staffId } }),
    prisma.permissionOverride.createMany({
      data: Object.entries(patch.overrides).map(([permission, effect]) => ({
        staffId,
        permission,
        effect,
      })),
    }),
    prisma.auditEvent.create({
      data: {
        actorId,
        action: "staff.role_changed",
        subjectId: staffId,
        details: { role: patch.role, overrides: patch.overrides },
      },
    }),
  ]);
  const staffMember = await prisma.staffUser.findUniqueOrThrow({
    where: { id: staffId },
    include: staffWithOverrides,
  });
  return { ok: true as const, staffMember: serializeStaff(staffMember) };
}

export async function revokeStaff(actorId: string, staffId: string) {
  const outcome = await prisma.staffUser.updateMany({
    where: { id: staffId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (outcome.count === 0) return false;
  await prisma.auditEvent.create({
    data: { actorId, action: "staff.revoked", subjectId: staffId, details: {} },
  });
  return true;
}

export async function startImpersonation(actorId: string, staffId: string) {
  const staffMember = await prisma.staffUser.findFirst({
    where: { id: staffId, revokedAt: null },
  });
  if (!staffMember) return false;
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "staff.impersonation_started",
      subjectId: staffId,
      details: { actorId, targetEmail: staffMember.email },
    },
  });
  return true;
}

export function hasStaffPermission(staffMember: StaffUser, permission: Permission) {
  return !staffMember.revokedAt && hasPermission(staffMember.role, staffMember.overrides, permission);
}
