import 'server-only';

import { Prisma, type StaffUser } from '@prisma/client';

import { db } from './db';
import { normalizeEmail } from './core/normalize';
import { failure, ok, type Result } from './core/result';

export const SETUP_LOCK_KEY = 'setup.completed';

export async function isSetupLocked(): Promise<boolean> {
  const [lock, staffCount] = await Promise.all([
    db.setting.findUnique({ where: { key: SETUP_LOCK_KEY } }),
    db.staffUser.count(),
  ]);

  return lock !== null || staffCount > 0;
}

/**
 * Creates the very first manager on an empty database and locks setup in the
 * same transaction. The lock is a unique primary key, so two simultaneous
 * submissions cannot both create a manager: the second one hits the constraint
 * and rolls back.
 */
export async function bootstrapFirstManager(input: {
  email: string;
  fullName: string;
  externalAuthId: string | null;
}): Promise<Result<StaffUser>> {
  const email = normalizeEmail(input.email);
  const fullName = input.fullName.trim();

  if (!email.includes('@')) {
    return failure('invalid_email', 'Enter the email address the first manager will sign in with.');
  }
  if (fullName.length === 0) {
    return failure('invalid_name', "Enter the first manager's full name.");
  }

  try {
    const manager = await db.$transaction(async (tx) => {
      if ((await tx.staffUser.count()) > 0) {
        throw new SetupAlreadyCompleted();
      }

      await tx.setting.create({ data: { key: SETUP_LOCK_KEY, value: true } });

      const created = await tx.staffUser.create({
        data: {
          email,
          fullName,
          externalAuthId: input.externalAuthId,
          role: 'MANAGER',
          status: 'ACTIVE',
          confirmedAt: new Date(),
        },
      });

      await tx.auditEvent.create({
        data: {
          action: 'setup.first_manager_created',
          entityType: 'StaffUser',
          entityId: created.id,
          actorLabel: 'first-run setup',
          detail: { email },
        },
      });

      return created;
    });

    return ok(manager);
  } catch (error) {
    if (error instanceof SetupAlreadyCompleted) return setupLockedFailure();
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return setupLockedFailure();
    }
    throw error;
  }
}

class SetupAlreadyCompleted extends Error {}

function setupLockedFailure(): Result<StaffUser> {
  return failure(
    'setup_locked',
    'Setup has already been completed. Ask an existing manager to invite you.',
  );
}
