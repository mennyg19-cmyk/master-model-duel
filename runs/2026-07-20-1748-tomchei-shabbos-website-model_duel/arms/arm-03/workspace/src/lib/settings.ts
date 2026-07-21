import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { err, ok, type Result } from "@/lib/result";

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}

export async function setSetting(
  key: string,
  value: Prisma.InputJsonValue,
  expectedVersion?: number,
): Promise<Result<{ version: number }>> {
  const existing = await db.appSetting.findUnique({ where: { key } });
  if (!existing) {
    const created = await db.appSetting.create({
      data: { key, value, version: 1 },
    });
    return ok({ version: created.version });
  }
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    return err(
      `version conflict: expected ${expectedVersion}, found ${existing.version}`,
      "This setting was changed by someone else. Reload and try again.",
    );
  }
  const updated = await db.appSetting.update({
    where: { key },
    data: { value, version: { increment: 1 } },
  });
  return ok({ version: updated.version });
}
