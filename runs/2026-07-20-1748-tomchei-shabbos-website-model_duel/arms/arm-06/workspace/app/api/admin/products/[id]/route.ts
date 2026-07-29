import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { dollarsToCents } from "@/lib/money";
import { productInputSchema, productScalars } from "@/lib/catalog/product-input";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const optionsSchema = z.array(
  z.object({
    name: z.string().min(1).max(120),
    values: z
      .array(
        z.object({
          label: z.string().min(1).max(120),
          priceDeltaDollars: z.coerce.number(),
        }),
      )
      .min(1),
  }),
);

// Two shapes, one route: the edit form posts the full scalar set; the options
// manager posts { options } alone. Upsert-only by design — OrderLine →
// ProductOptionValue is RESTRICT, so deleting options/values could break paid
// snapshots. Existing names/labels get their deltas updated; new ones are
// created; omitted ones stay.
const patchSchema = z
  .object({ options: optionsSchema.optional() })
  .passthrough();

export async function PATCH(request: Request, { params }: Props) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Product fields are missing or invalid" }, { status: 400 });
  }

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const isScalarUpdate = typeof parsed.data.name === "string";
  let scalarData: ReturnType<typeof productScalars>["data"] | null = null;
  let seasonId: string | null = null;
  let replacedById: string | null | undefined;
  let addOnIds: string[] | null = null;
  let basePriceCents = existing.basePriceCents;

  if (isScalarUpdate) {
    const full = productInputSchema.safeParse(raw);
    if (!full.success) {
      return NextResponse.json({ error: "Product fields are missing or invalid" }, { status: 400 });
    }
    const scalars = productScalars(full.data);
    if (!scalars.ok) {
      return NextResponse.json({ error: scalars.error }, { status: 400 });
    }
    scalarData = scalars.data;
    basePriceCents = scalarData.basePriceCents;

    const season = await prisma.season.findUnique({ where: { id: full.data.seasonId } });
    if (!season) {
      return NextResponse.json({ error: "Unknown season" }, { status: 400 });
    }
    seasonId = season.id;

    replacedById = full.data.replacedById || null;
    if (replacedById) {
      if (replacedById === id) {
        return NextResponse.json({ error: "A product cannot replace itself" }, { status: 400 });
      }
      const target = await prisma.product.findUnique({ where: { id: replacedById }, include: { season: true } });
      if (!target) {
        return NextResponse.json({ error: "Unknown replacement product" }, { status: 400 });
      }
      // Replacement chains walk forward (P10): the replacement must belong to
      // a strictly newer season than the product being replaced. "Newer" is
      // creation order — season names are free-form strings, not a recency key.
      if (target.season.createdAt <= season.createdAt) {
        return NextResponse.json(
          { error: "A replacement product must belong to a newer season" },
          { status: 400 },
        );
      }
    }

    // Omitted addOnIds preserves the restriction set (options-only and
    // partial scalar PATCHes must not silently wipe it); an explicit empty
    // array still clears it.
    addOnIds = full.data.addOnIds ?? null;
    if (addOnIds !== null && addOnIds.length > 0) {
      const addOnCount = await prisma.addOn.count({ where: { id: { in: addOnIds } } });
      if (addOnCount !== addOnIds.length) {
        return NextResponse.json({ error: "Unknown add-on in the restriction list" }, { status: 400 });
      }
    }
  }

  const optionInputs = parsed.data.options ?? [];
  const convertedOptions: { name: string; values: { label: string; priceDeltaCents: number }[] }[] = [];
  for (const option of optionInputs) {
    const values = [];
    for (const value of option.values) {
      const priceDeltaCents = dollarsToCents(value.priceDeltaDollars);
      if (priceDeltaCents === null) {
        return NextResponse.json(
          { error: `Option "${option.name}" has a price adjustment that isn't a clean dollar amount` },
          { status: 400 },
        );
      }
      if (basePriceCents + priceDeltaCents < 0) {
        return NextResponse.json(
          { error: `Option "${option.name}" adjustment would push the price below zero` },
          { status: 400 },
        );
      }
      values.push({ label: value.label.trim(), priceDeltaCents });
    }
    convertedOptions.push({ name: option.name.trim(), values });
  }

  const product = await prisma.$transaction(async (tx) => {
    const updated = isScalarUpdate
      ? await tx.product.update({
          where: { id },
          data: { ...scalarData!, seasonId: seasonId!, replacedById },
        })
      : existing;

    if (addOnIds !== null) {
      await tx.productAddOn.deleteMany({ where: { productId: id } });
      if (addOnIds.length > 0) {
        await tx.productAddOn.createMany({
          data: addOnIds.map((addOnId) => ({ productId: id, addOnId })),
        });
      }
    }

    for (const option of convertedOptions) {
      const optionRow = await tx.productOption.upsert({
        where: { productId_name: { productId: id, name: option.name } },
        update: {},
        create: { productId: id, name: option.name },
      });
      for (const value of option.values) {
        await tx.productOptionValue.upsert({
          where: { optionId_label: { optionId: optionRow.id, label: value.label } },
          update: { priceDeltaCents: value.priceDeltaCents },
          create: { optionId: optionRow.id, label: value.label, priceDeltaCents: value.priceDeltaCents },
        });
      }
    }

    return updated;
  });

  await recordAudit({
    ctx: gate.ctx,
    action: "product_update",
    targetType: "Product",
    targetId: product.id,
    metadata: { slug: product.slug, scope: isScalarUpdate ? "scalars" : "options" },
  });

  return NextResponse.json({ product });
}
