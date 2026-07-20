import { ProductKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

function handleCatalogError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  throw error;
}

export async function POST(request: Request) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const body = (await request.json()) as {
      seasonId?: string;
      sku?: string;
      name?: string;
      description?: string;
      category?: string;
      kind?: ProductKind;
      priceCents?: number;
      imageUrl?: string;
      tracksInventory?: boolean;
    };
    if (
      !body.seasonId ||
      !body.sku?.trim() ||
      !body.name?.trim() ||
      !body.kind ||
      !Object.values(ProductKind).includes(body.kind) ||
      !Number.isInteger(body.priceCents) ||
      (body.priceCents ?? -1) < 0
    ) {
      return NextResponse.json(
        { error: "Season, SKU, name, valid kind, and a non-negative price are required." },
        { status: 400 },
      );
    }

    const product = await db.$transaction(async (transaction) => {
      const createdProduct = await transaction.product.create({
        data: {
          seasonId: body.seasonId!,
          sku: body.sku!.trim().toUpperCase(),
          name: body.name!.trim(),
          description: body.description?.trim() || null,
          category: body.category?.trim() || "Gifts",
          kind: body.kind!,
          priceCents: body.priceCents!,
          imageUrl: body.imageUrl?.trim() || null,
          tracksInventory: body.tracksInventory ?? true,
          isFinishedPackage: body.kind === ProductKind.PACKAGE,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "catalog.product_created",
          targetType: "Product",
          targetId: createdProduct.id,
        },
      });
      return createdProduct;
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return handleCatalogError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const body = (await request.json()) as {
      id?: string;
      version?: number;
      name?: string;
      description?: string;
      category?: string;
      priceCents?: number;
      imageUrl?: string | null;
      replacementProductId?: string | null;
      isActive?: boolean;
    };
    if (!body.id || !body.version) {
      return NextResponse.json(
        { error: "Product ID and version are required." },
        { status: 400 },
      );
    }
    if (body.priceCents !== undefined && (!Number.isInteger(body.priceCents) || body.priceCents < 0)) {
      return NextResponse.json({ error: "Price must be a non-negative whole number of cents." }, { status: 400 });
    }
    if (body.name !== undefined && !body.name.trim()) {
      return NextResponse.json({ error: "Product name cannot be blank." }, { status: 400 });
    }

    const product = await db.$transaction(async (transaction) => {
      const updateCount = await transaction.product.updateMany({
        where: { id: body.id, version: body.version },
        data: {
          name: body.name?.trim(),
          description: body.description?.trim(),
          category: body.category?.trim(),
          priceCents: body.priceCents,
          imageUrl: body.imageUrl,
          replacementProductId: body.replacementProductId,
          isActive: body.isActive,
          version: { increment: 1 },
        },
      });
      if (updateCount.count !== 1) return null;
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "catalog.product_updated",
          targetType: "Product",
          targetId: body.id!,
        },
      });
      return transaction.product.findUnique({ where: { id: body.id } });
    });
    if (!product) {
      return NextResponse.json(
        { error: "This product changed. Reload before saving again." },
        { status: 409 },
      );
    }
    return NextResponse.json({ product });
  } catch (error) {
    return handleCatalogError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const staffSession = await requirePermission("settings:manage");
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get("id");
    const version = Number(searchParams.get("version"));
    if (!id || !Number.isInteger(version) || version < 1) {
      return NextResponse.json(
        { error: "Product ID and version are required." },
        { status: 400 },
      );
    }

    const result = await db.$transaction(async (transaction) => {
      const updateCount = await transaction.product.updateMany({
        where: { id, version },
        data: { isActive: false, version: { increment: 1 } },
      });
      if (updateCount.count !== 1) {
        const existing = await transaction.product.findUnique({
          where: { id },
          select: { id: true },
        });
        return existing ? "conflict" : "missing";
      }
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "catalog.product_archived",
          targetType: "Product",
          targetId: id,
        },
      });
      return "archived";
    });
    if (result === "missing") {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    if (result === "conflict") {
      return NextResponse.json(
        { error: "This product changed. Reload before archiving it." },
        { status: 409 },
      );
    }
    return NextResponse.json({ archived: true });
  } catch (error) {
    return handleCatalogError(error);
  }
}
