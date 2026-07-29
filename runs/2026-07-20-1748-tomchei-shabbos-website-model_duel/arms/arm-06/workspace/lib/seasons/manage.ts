/**
 * P10 (G-011 / R-041): season lifecycle — new-season wizard (with optional
 * catalog copy), the manager Open/Closed switch, scheduled auto-flip fields,
 * and the cron tick that executes due flips.
 *
 * Single-open-season is enforced by a partial unique index in the DB; every
 * write here runs in a transaction so a failed flip never leaves two seasons
 * half-open. Opening a season auto-closes whichever season was open — that
 * IS the year flip (G-011); the audit row records both sides.
 */
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { getSeasonYear } from "@/lib/seasons/year";

export interface SeasonWizardInput {
  name: string;
  /** Copy this season's products/options/add-on restrictions into the new season. */
  copyCatalogFromSeasonId?: string;
  scheduledOpensAt?: Date | null;
  scheduledClosesAt?: Date | null;
  ctx: AuditContextLike;
}

function assertSchedule(opensAt: Date | null | undefined, closesAt: Date | null | undefined) {
  if (opensAt && closesAt && opensAt >= closesAt) {
    throw new DomainRuleError("Scheduled open must be before scheduled close");
  }
}

/** Fresh slug for a copied product: carry the base, re-suffix with the new season's year. */
function copiedSlug(sourceSlug: string, year: number): string {
  const base = sourceSlug.replace(/-20\d{2}$/, "");
  return `${base}-${year}`;
}

export async function createSeasonWizard(input: SeasonWizardInput): Promise<{ seasonId: string; copiedProducts: number }> {
  const name = input.name.trim();
  if (!name) throw new DomainRuleError("Season name is required");
  assertSchedule(input.scheduledOpensAt, input.scheduledClosesAt);

  const existing = await prisma.season.findUnique({ where: { name } });
  if (existing) throw new DomainRuleError(`Season "${name}" already exists`);

  const source = input.copyCatalogFromSeasonId
    ? await prisma.season.findUnique({
        where: { id: input.copyCatalogFromSeasonId },
        include: {
          products: {
            include: { options: { include: { values: true } }, allowedAddOns: true },
          },
        },
      })
    : null;
  if (input.copyCatalogFromSeasonId && !source) {
    throw new NotFoundError("Season", input.copyCatalogFromSeasonId);
  }

  const year = getSeasonYear(new Date());
  const season = await prisma.season.create({
    data: {
      name,
      // Wizard seasons are born CLOSED — the manager flips Open explicitly
      // (or schedules the flip), so the storefront never shows a half-built catalog.
      status: "CLOSED",
      scheduledOpensAt: input.scheduledOpensAt ?? null,
      scheduledClosesAt: input.scheduledClosesAt ?? null,
    },
  });

  let copiedProducts = 0;
  if (source) {
    for (const product of source.products) {
      await prisma.product.create({
        data: {
          slug: copiedSlug(product.slug, year),
          name: product.name,
          description: product.description,
          kind: product.kind,
          basePriceCents: product.basePriceCents,
          category: product.category,
          seasonId: season.id,
          lengthMm: product.lengthMm,
          widthMm: product.widthMm,
          heightMm: product.heightMm,
          weightGrams: product.weightGrams,
          trackInventory: product.trackInventory,
          allowBackorder: product.allowBackorder,
          active: product.active,
          // Replacement links are deliberately NOT copied: the old season's
          // discontinued products get mapped FORWARD onto these copies via
          // the product editor (UR-007), never the reverse.
          options: {
            create: product.options.map((option) => ({
              name: option.name,
              values: {
                create: option.values.map((value) => ({
                  label: value.label,
                  priceDeltaCents: value.priceDeltaCents,
                })),
              },
            })),
          },
          allowedAddOns: {
            create: product.allowedAddOns.map((restriction) => ({ addOnId: restriction.addOnId })),
          },
        },
      });
      copiedProducts++;
    }
  }

  await recordAudit({
    ctx: input.ctx,
    action: "season_create",
    targetType: "Season",
    targetId: season.id,
    metadata: { name, copiedProducts, copiedFrom: source?.name ?? null },
  });
  return { seasonId: season.id, copiedProducts };
}

/** Manager Open/Closed switch. Opening auto-closes the previously open season (the flip). */
export async function setSeasonStatus(input: {
  seasonId: string;
  status: "OPEN" | "CLOSED";
  ctx: AuditContextLike;
}): Promise<{ flippedFrom?: string }> {
  return prisma.$transaction(async (tx) => {
    const season = await tx.season.findUnique({ where: { id: input.seasonId } });
    if (!season) throw new NotFoundError("Season", input.seasonId);
    if (season.status === input.status) {
      throw new DomainRuleError(`Season ${season.name} is already ${input.status}`);
    }

    let flippedFrom: string | undefined;
    if (input.status === "OPEN") {
      const currentlyOpen = await tx.season.findFirst({ where: { status: "OPEN" } });
      if (currentlyOpen) {
        await tx.season.update({ where: { id: currentlyOpen.id }, data: { status: "CLOSED" } });
        flippedFrom = currentlyOpen.name;
      }
      // A scheduled open in the past has fired; clear consumed schedule on manual flip.
      await tx.season.update({
        where: { id: season.id },
        data: { status: "OPEN", scheduledOpensAt: null },
      });
    } else {
      await tx.season.update({
        where: { id: season.id },
        data: { status: "CLOSED", scheduledClosesAt: null },
      });
    }

    await recordAudit(
      {
        ctx: input.ctx,
        action: input.status === "OPEN" ? "season_open" : "season_close",
        targetType: "Season",
        targetId: season.id,
        metadata: { name: season.name, flippedFrom: flippedFrom ?? null },
      },
      tx,
    );
    return { flippedFrom };
  });
}

export async function setSeasonSchedule(input: {
  seasonId: string;
  scheduledOpensAt?: Date | null;
  scheduledClosesAt?: Date | null;
  ctx: AuditContextLike;
}): Promise<void> {
  assertSchedule(input.scheduledOpensAt, input.scheduledClosesAt);
  const season = await prisma.season.findUnique({ where: { id: input.seasonId } });
  if (!season) throw new NotFoundError("Season", input.seasonId);
  // Patch semantics: undefined leaves the column alone, null clears it.
  const data: { scheduledOpensAt?: Date | null; scheduledClosesAt?: Date | null } = {};
  if (input.scheduledOpensAt !== undefined) data.scheduledOpensAt = input.scheduledOpensAt;
  if (input.scheduledClosesAt !== undefined) data.scheduledClosesAt = input.scheduledClosesAt;
  if (Object.keys(data).length === 0) return;
  await prisma.season.update({ where: { id: season.id }, data });
  await recordAudit({
    ctx: input.ctx,
    action: "season_schedule",
    targetType: "Season",
    targetId: season.id,
    metadata: {
      name: season.name,
      scheduledOpensAt: input.scheduledOpensAt?.toISOString() ?? null,
      scheduledClosesAt: input.scheduledClosesAt?.toISOString() ?? null,
    },
  });
}

/**
 * Cron tick (R-041): close OPEN seasons past their scheduledClosesAt, then
 * open CLOSED seasons whose scheduledOpensAt has arrived. Times are stored
 * UTC — the admin UI converts manager-local input before saving. Every run
 * leaves a CronRun row, flip or no-flip (same discipline as the other crons).
 */
export async function runSeasonFlip(now = new Date()): Promise<{ closed: string[]; opened: string[] }> {
  const cronRun = await prisma.cronRun.create({ data: { name: "season-flip" } });
  const closed: string[] = [];
  const opened: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      const toClose = await tx.season.findMany({
        where: { status: "OPEN", scheduledClosesAt: { lte: now } },
      });
      for (const season of toClose) {
        await tx.season.update({
          where: { id: season.id },
          data: { status: "CLOSED", scheduledClosesAt: null },
        });
        closed.push(season.name);
      }

      const toOpen = await tx.season.findMany({
        where: { status: "CLOSED", scheduledOpensAt: { lte: now } },
        orderBy: { scheduledOpensAt: "asc" },
      });
      for (const season of toOpen) {
        // Skip a stale schedule whose close already passed un-fired.
        if (season.scheduledClosesAt && season.scheduledClosesAt <= now) continue;
        const stillOpen = await tx.season.findFirst({ where: { status: "OPEN" } });
        if (stillOpen) {
          await tx.season.update({ where: { id: stillOpen.id }, data: { status: "CLOSED" } });
          closed.push(stillOpen.name);
        }
        await tx.season.update({
          where: { id: season.id },
          data: { status: "OPEN", scheduledOpensAt: null },
        });
        opened.push(season.name);
      }
    });

    if (closed.length > 0 || opened.length > 0) {
      await recordAudit({
        actor: null,
        action: "season_schedule",
        targetType: "Season",
        metadata: { cron: "season-flip", at: now.toISOString(), closed, opened },
      });
    }
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: {
        status: "OK",
        finishedAt: new Date(),
        message: `closed=[${closed.join(", ")}] opened=[${opened.join(", ")}]`,
      },
    });
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        message: error instanceof Error ? error.message : "season flip failed",
      },
    });
    throw error;
  }
  return { closed, opened };
}
