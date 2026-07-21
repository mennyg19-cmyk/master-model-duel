import { AuditAction, SeasonStatus, type Season } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { err, maskError, ok, type Result } from "@/lib/result";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** R-097 — create a new season (starts CLOSED until manager opens or auto-flip). */
export async function createSeason(input: {
  name: string;
  year: number;
  slug?: string;
  scheduledOpenAt?: Date | null;
  scheduledCloseAt?: Date | null;
  staffId: string;
  copyFulfillmentDefaults?: boolean;
}): Promise<Result<{ season: Season }>> {
  try {
    const slug = input.slug?.trim() || slugify(`${input.name}-${input.year}`);
    if (!slug) return err("slug", "Season slug is required.");
    if (!Number.isFinite(input.year) || input.year < 2000 || input.year > 2100) {
      return err("year", "Year must be between 2000 and 2100.");
    }

    const existing = await db.season.findUnique({ where: { slug } });
    if (existing) return err("duplicate", `Season slug "${slug}" already exists.`);

    const season = await db.$transaction(async (tx) => {
      const created = await tx.season.create({
        data: {
          slug,
          name: input.name.trim(),
          year: input.year,
          status: SeasonStatus.CLOSED,
          scheduledOpenAt: input.scheduledOpenAt ?? null,
          scheduledCloseAt: input.scheduledCloseAt ?? null,
        },
      });
      await writeAudit(
        {
          action: AuditAction.SETTINGS_UPDATED,
          actorId: input.staffId,
          meta: {
            kind: "season_created",
            seasonId: created.id,
            slug: created.slug,
            year: created.year,
          },
        },
        tx,
      );
      return created;
    });

    return ok({ season });
  } catch (error) {
    return err(maskError(error), "Could not create season.");
  }
}

/** UR-008 — manager Open/Closed switch (closes other OPEN seasons when opening). */
export async function setSeasonStatus(input: {
  seasonId: string;
  status: SeasonStatus;
  staffId: string;
}): Promise<Result<{ season: Season }>> {
  try {
    const season = await db.$transaction(async (tx) => {
      if (input.status === SeasonStatus.OPEN) {
        await tx.season.updateMany({
          where: { status: SeasonStatus.OPEN, NOT: { id: input.seasonId } },
          data: { status: SeasonStatus.CLOSED },
        });
      }
      const updated = await tx.season.update({
        where: { id: input.seasonId },
        data: {
          status: input.status,
          opensAt:
            input.status === SeasonStatus.OPEN ? new Date() : undefined,
          closesAt:
            input.status === SeasonStatus.CLOSED ? new Date() : undefined,
        },
      });
      await writeAudit(
        {
          action: AuditAction.SETTINGS_UPDATED,
          actorId: input.staffId,
          meta: {
            kind: "season_gate",
            seasonId: updated.id,
            status: updated.status,
          },
        },
        tx,
      );
      return updated;
    });
    return ok({ season });
  } catch (error) {
    return err(maskError(error), "Could not update season status.");
  }
}

/** Schedule optional auto-flip times (org-local clock assumed as server time). */
export async function scheduleSeasonFlip(input: {
  seasonId: string;
  scheduledOpenAt?: Date | null;
  scheduledCloseAt?: Date | null;
  staffId: string;
}): Promise<Result<{ season: Season }>> {
  try {
    const season = await db.season.update({
      where: { id: input.seasonId },
      data: {
        scheduledOpenAt:
          input.scheduledOpenAt === undefined
            ? undefined
            : input.scheduledOpenAt,
        scheduledCloseAt:
          input.scheduledCloseAt === undefined
            ? undefined
            : input.scheduledCloseAt,
      },
    });
    await writeAudit({
      action: AuditAction.SETTINGS_UPDATED,
      actorId: input.staffId,
      meta: {
        kind: "season_schedule",
        seasonId: season.id,
        scheduledOpenAt: season.scheduledOpenAt?.toISOString() ?? null,
        scheduledCloseAt: season.scheduledCloseAt?.toISOString() ?? null,
      },
    });
    return ok({ season });
  } catch (error) {
    return err(maskError(error), "Could not schedule season flip.");
  }
}

/**
 * Cron: open seasons whose scheduledOpenAt <= now; close those past scheduledCloseAt.
 * Opening a season closes other OPEN seasons (single current season).
 */
export async function applyScheduledSeasonFlips(now = new Date()): Promise<{
  opened: string[];
  closed: string[];
}> {
  const opened: string[] = [];
  const closed: string[] = [];

  const dueOpen = await db.season.findMany({
    where: {
      status: { not: SeasonStatus.OPEN },
      scheduledOpenAt: { lte: now },
    },
    orderBy: { scheduledOpenAt: "asc" },
  });

  for (const season of dueOpen) {
    await db.$transaction(async (tx) => {
      await tx.season.updateMany({
        where: { status: SeasonStatus.OPEN, NOT: { id: season.id } },
        data: { status: SeasonStatus.CLOSED, closesAt: now },
      });
      await tx.season.update({
        where: { id: season.id },
        data: {
          status: SeasonStatus.OPEN,
          opensAt: now,
          scheduledOpenAt: null,
        },
      });
      await writeAudit(
        {
          action: AuditAction.SETTINGS_UPDATED,
          actorId: null,
          meta: {
            kind: "season_auto_flip",
            seasonId: season.id,
            toStatus: SeasonStatus.OPEN,
            at: now.toISOString(),
          },
        },
        tx,
      );
    });
    opened.push(season.id);
  }

  const dueClose = await db.season.findMany({
    where: {
      status: SeasonStatus.OPEN,
      scheduledCloseAt: { lte: now },
    },
  });

  for (const season of dueClose) {
    await db.$transaction(async (tx) => {
      await tx.season.update({
        where: { id: season.id },
        data: {
          status: SeasonStatus.CLOSED,
          closesAt: now,
          scheduledCloseAt: null,
        },
      });
      await writeAudit(
        {
          action: AuditAction.SETTINGS_UPDATED,
          actorId: null,
          meta: {
            kind: "season_auto_flip",
            seasonId: season.id,
            toStatus: SeasonStatus.CLOSED,
            at: now.toISOString(),
          },
        },
        tx,
      );
    });
    closed.push(season.id);
  }

  return { opened, closed };
}

export async function listSeasons() {
  return db.season.findMany({
    orderBy: [{ year: "desc" }, { name: "asc" }],
  });
}
