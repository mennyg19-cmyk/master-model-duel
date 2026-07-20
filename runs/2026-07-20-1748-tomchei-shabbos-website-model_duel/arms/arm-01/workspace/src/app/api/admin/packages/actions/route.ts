import { PackageStage } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  bulkAdvancePackageStage,
  materializeMissingFinalizedOrders,
  regroupPackages,
  splitPackage,
} from "@/domain/package-operations";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const packageActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("materialize"),
  }),
  z.object({
    action: z.literal("split"),
    packageId: z.string().min(1),
    packageLineId: z.string().min(1),
    quantity: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("regroup"),
    sourcePackageId: z.string().min(1),
    targetPackageId: z.string().min(1),
  }),
  z.object({
    action: z.literal("status"),
    packages: z
      .array(
        z.object({
          packageId: z.string().min(1),
          version: z.number().int().positive(),
          stage: z.enum(PackageStage),
        }),
      )
      .min(1)
      .max(100),
  }),
]);

export async function POST(request: Request) {
  try {
    const session = await requirePermission("orders:manage");
    const parsed = packageActionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Package action details are invalid." },
        { status: 400 },
      );
    }
    const input = parsed.data;
    if (input.action === "materialize") {
      return NextResponse.json(await materializeMissingFinalizedOrders(db));
    }
    if (input.action === "split") {
      const createdPackage = await splitPackage(db, {
        ...input,
        actorStaffId: session.actor.id,
      });
      return NextResponse.json({ createdPackage });
    }
    if (input.action === "regroup") {
      const targetPackage = await regroupPackages(
        db,
        input.sourcePackageId,
        input.targetPackageId,
        session.actor.id,
      );
      return NextResponse.json({ targetPackage });
    }
    return NextResponse.json(
      await bulkAdvancePackageStage(
        db,
        session.actor.id,
        input.packages,
      ),
    );
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Package action failed." },
      { status: 409 },
    );
  }
}
