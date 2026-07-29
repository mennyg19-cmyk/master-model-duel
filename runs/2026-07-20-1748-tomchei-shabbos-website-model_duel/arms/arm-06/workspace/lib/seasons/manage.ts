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
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { getSeasonYear } from "@/lib/seasons/year";
import { copyObject } from "@/lib/media/storage";

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
  // Any 4-digit year suffix strips — a copied-then-recopied slug must not
  // cascade into `foo-1999-2027`.
  const base = sourceSlug.replace(/-\d{4}$/, "");
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
            include: { options: { include: { values: true } }, allowedAddOns: true, media: true },
          },
        },
      })
    : null;
  if (input.copyCatalogFromSeasonId && !source) {
    throw new NotFoundError("Season", input.copyCatalogFromSeasonId);
  }

  const year = getSeasonYear(new Date());

  // Intra-run slug guard: two source slugs that strip to the same base
  // (basket-2025 + basket-2026 → basket-2027) would collide on the unique
  // index mid-copy — refuse up front instead of failing partway.
  const targetSlugs = new Map<string, string[]>();
  for (const product of source?.products ?? []) {
    const slug = copiedSlug(product.slug, year);
    targetSlugs.set(slug, [...(targetSlugs.get(slug) ?? []), product.slug]);
  }
  const collided = [...targetSlugs].filter(([, sources]) => sources.length > 1);
  if (collided.length > 0) {
    throw new DomainRuleError(
      `Catalog copy would collide on ${collided
        .map(([slug, sources]) => `"${slug}" (from ${sources.join(", ")})`)
        .join("; ")} — rename the source products first`,
    );
  }

  // Media bytes duplicate up front so each copied asset owns its own stored
  // object — a later delete on either side never yanks the other's photo.
  // Done before the transaction: a failed copy writes nothing to the DB.
  const mediaCopies = new Map<
    string,
    { url: string; storedName: string; filename: string; contentType: string; sizeBytes: number; driver: string }[]
  >();
  for (const product of source?.products ?? []) {
    for (const asset of product.media) {
      const stored = await copyObject(asset);
      const copies = mediaCopies.get(product.id) ?? [];
      copies.push({
        url: stored.url,
        storedName: stored.storedName,
        filename: asset.filename,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        driver: stored.driver,
      });
      mediaCopies.set(product.id, copies);
    }
  }

  try {
    // Season + catalog copy commit atomically (the file-header invariant):
    // a failure midway leaves no CLOSED season with a half-built catalog.
    return await prisma.$transaction(
      async (tx) => {
        // Inter-run slug guard: a previous wizard into the same year already
        // owns a target slug — clean DomainRuleError, not a Prisma 500.
        const taken = await tx.product.findMany({
          where: { slug: { in: [...targetSlugs.keys()] } },
          select: { slug: true },
        });
        if (taken.length > 0) {
          throw new DomainRuleError(
            `Slug ${taken.map((row) => `"${row.slug}"`).join(", ")} already exists — the catalog may already have been copied into a ${year} season`,
          );
        }

        const season = await tx.season.create({
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
        for (const product of source?.products ?? []) {
          await tx.product.create({
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
              media: {
                create: mediaCopies.get(product.id) ?? [],
              },
            },
          });
          copiedProducts++;
        }

        await recordAudit(
          {
            ctx: input.ctx,
            action: "season_create",
            targetType: "Season",
            targetId: season.id,
            metadata: {
              name,
              copiedProducts,
              copiedMedia: [...mediaCopies.values()].reduce((count, copies) => count + copies.length, 0),
              copiedFrom: source?.name ?? null,
            },
          },
          tx,
        );
        return { seasonId: season.id, copiedProducts };
      },
      // A full-catalog copy is one interactive transaction of nested creates;
      // the 5s default is not sized for it.
      { timeout: 30_000 },
    );
  } catch (error) {
    // Unique-index race backstop (season name or a product slug claimed by a
    // concurrent wizard between the guards and the writes).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainRuleError(
        "The season name or a copied product slug already exists — check for another wizard run into the same year",
      );
    }
    throw error;
  }
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
  // Update + audit commit together — a schedule change must never lose its
  // trail (same discipline as setSeasonStatus).
  await prisma.$transaction(async (tx) => {
    await tx.season.update({ where: { id: season.id }, data });
    await recordAudit(
      {
        ctx: input.ctx,
        action: "season_schedule",
        targetType: "Season",
        targetId: season.id,
        metadata: {
          name: season.name,
          scheduledOpensAt: input.scheduledOpensAt?.toISOString() ?? null,
          scheduledClosesAt: input.scheduledClosesAt?.toISOString() ?? null,
        },
      },
      tx,
    );
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
  const staleCleared: string[] = [];
  let openedSeasonId: string | undefined;

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
        // A stale schedule whose close already passed un-fired is dead —
        // clear it so the cron stops re-evaluating it every tick.
        if (season.scheduledClosesAt && season.scheduledClosesAt <= now) {
          await tx.season.update({
            where: { id: season.id },
            data: { scheduledOpensAt: null, scheduledClosesAt: null },
          });
          staleCleared.push(season.name);
          continue;
        }
        // One flip per tick — the same discipline as the manual manager
        // flip. Remaining due seasons fire on later ticks, so the audit row
        // never claims a season opened that the same tick closed again.
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
        openedSeasonId = season.id;
        break;
      }
    });

    if (closed.length > 0 || opened.length > 0 || staleCleared.length > 0) {
      await recordAudit({
        actor: null,
        action: "season_flip_cron",
        targetType: "Season",
        targetId: openedSeasonId ?? undefined,
        metadata: {
          cron: "season-flip",
          at: now.toISOString(),
          closed,
          opened,
          clearedStaleSchedules: staleCleared,
        },
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
