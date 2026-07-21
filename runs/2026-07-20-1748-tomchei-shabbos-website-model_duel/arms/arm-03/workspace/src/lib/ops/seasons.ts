import { AuditAction, SeasonStatus, type Prisma, type Season } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { err, maskError, ok, type Result } from "@/lib/result";

type Tx = Prisma.TransactionClient;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function listSeasons(): Promise<Season[]> {
  return db.season.findMany({ orderBy: [{ year: "desc" }, { name: "asc" }] });
}

export async function setSeasonGate(input: {
  seasonId: string;
  status: SeasonStatus;
  staffId: string;
  scheduledOpenAt?: Date | null;
  scheduledCloseAt?: Date | null;
}): Promise<Result<{ season: Season }>> {
  try {
    const season = await db.$transaction(async (tx) => {
      if (input.status === SeasonStatus.OPEN) {
        await tx.season.updateMany({
          where: { status: SeasonStatus.OPEN, NOT: { id: input.seasonId } },
          data: { status: SeasonStatus.CLOSED },
        });
      }
      const data: Prisma.SeasonUpdateInput = { status: input.status };
      if (input.scheduledOpenAt !== undefined) data.scheduledOpenAt = input.scheduledOpenAt;
      if (input.scheduledCloseAt !== undefined) data.scheduledCloseAt = input.scheduledCloseAt;
      if (input.status === SeasonStatus.OPEN && !input.scheduledOpenAt) {
        data.opensAt = new Date();
      }
      if (input.status === SeasonStatus.CLOSED) {
        data.closesAt = new Date();
      }
      return tx.season.update({ where: { id: input.seasonId }, data });
    });

    await writeAudit({
      action: AuditAction.SETTINGS_UPDATED,
      actorId: input.staffId,
      meta: {
        kind: "season_gate",
        seasonId: season.id,
        status: season.status,
        scheduledOpenAt: season.scheduledOpenAt,
        scheduledCloseAt: season.scheduledCloseAt,
      },
    });

    return ok({ season });
  } catch (error) {
    return err(maskError(error), "Could not update season gate.");
  }
}

/** New-season wizard (R-097): create CLOSED season; optional catalog shell copy. */
export async function createSeasonWizard(input: {
  name: string;
  year: number;
  slug?: string;
  copyFromSeasonId?: string | null;
  scheduledOpenAt?: Date | null;
  scheduledCloseAt?: Date | null;
  staffId: string;
}): Promise<Result<{ season: Season; productsCopied: number }>> {
  try {
    const slug = input.slug?.trim() || slugify(`${input.name}-${input.year}`);
    const existing = await db.season.findUnique({ where: { slug } });
    if (existing) return err("slug", `Season slug ${slug} already exists.`);

    const result = await db.$transaction(async (tx) => {
      const season = await tx.season.create({
        data: {
          name: input.name.trim(),
          year: input.year,
          slug,
          status: SeasonStatus.CLOSED,
          scheduledOpenAt: input.scheduledOpenAt ?? null,
          scheduledCloseAt: input.scheduledCloseAt ?? null,
        },
      });

      let productsCopied = 0;
      if (input.copyFromSeasonId) {
        productsCopied = await copyCatalogShell(tx, input.copyFromSeasonId, season.id);
      }

      await writeAudit(
        {
          action: AuditAction.SETTINGS_UPDATED,
          actorId: input.staffId,
          meta: {
            kind: "season_wizard",
            seasonId: season.id,
            slug: season.slug,
            copyFromSeasonId: input.copyFromSeasonId ?? null,
            productsCopied,
          },
        },
        tx,
      );

      return { season, productsCopied };
    });

    return ok(result);
  } catch (error) {
    return err(maskError(error), "Could not create season.");
  }
}

async function copyCatalogShell(
  tx: Tx,
  fromSeasonId: string,
  toSeasonId: string,
): Promise<number> {
  const products = await tx.product.findMany({
    where: { seasonId: fromSeasonId },
    include: { options: true },
  });
  let copied = 0;
  for (const product of products) {
    const created = await tx.product.create({
      data: {
        seasonId: toSeasonId,
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        kind: product.kind,
        category: product.category,
        description: product.description,
        basePriceCents: product.basePriceCents,
        weightOz: product.weightOz,
        lengthIn: product.lengthIn,
        widthIn: product.widthIn,
        heightIn: product.heightIn,
        tracksInventory: product.tracksInventory,
        isActive: product.isActive,
        sortOrder: product.sortOrder,
        primaryImageUrl: product.primaryImageUrl,
        mediaAssetId: product.mediaAssetId,
      },
    });
    for (const option of product.options) {
      await tx.productOption.create({
        data: {
          productId: created.id,
          name: option.name,
          priceAdjustmentCents: option.priceAdjustmentCents,
          sortOrder: option.sortOrder,
          isActive: option.isActive,
        },
      });
    }
    // Replacement edge: old product → new season twin (chain seed for repeat).
    await tx.productReplacement.create({
      data: {
        fromProductId: product.id,
        toProductId: created.id,
        note: "wizard_copy",
      },
    });
    copied += 1;
  }
  return copied;
}

/** Org-local auto-flip: open/close when scheduled times are due (UR-008). */
export async function runSeasonAutoFlip(now = new Date()): Promise<{
  opened: string[];
  closed: string[];
}> {
  const opened: string[] = [];
  const closed: string[] = [];

  const dueOpen = await db.season.findMany({
    where: {
      status: SeasonStatus.CLOSED,
      scheduledOpenAt: { lte: now },
    },
  });

  for (const season of dueOpen) {
    await db.$transaction(async (tx) => {
      await tx.season.updateMany({
        where: { status: SeasonStatus.OPEN, NOT: { id: season.id } },
        data: { status: SeasonStatus.CLOSED, closesAt: now },
      });
      await tx.season.update({
        where: { id: season.id },
        data: { status: SeasonStatus.OPEN, opensAt: now },
      });
    });
    await writeAudit({
      action: AuditAction.SETTINGS_UPDATED,
      meta: {
        kind: "season_auto_flip",
        seasonId: season.id,
        toStatus: SeasonStatus.OPEN,
        at: now.toISOString(),
      },
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
    // Skip if we just opened it in this sweep (same-second open+close).
    if (opened.includes(season.id)) continue;
    await db.season.update({
      where: { id: season.id },
      data: { status: SeasonStatus.CLOSED, closesAt: now },
    });
    await writeAudit({
      action: AuditAction.SETTINGS_UPDATED,
      meta: {
        kind: "season_auto_flip",
        seasonId: season.id,
        toStatus: SeasonStatus.CLOSED,
        at: now.toISOString(),
      },
    });
    closed.push(season.id);
  }

  return { opened, closed };
}
