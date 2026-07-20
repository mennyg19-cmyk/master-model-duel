import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buyPackageLabel,
  quotePackage,
  refreshPackageTracking,
  validatePackageAddress,
  voidPackageLabel,
} from "@/domain/shipping";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getShippingProvider } from "@/lib/shippo";

const shippingActionSchema = z.object({
  action: z.enum(["quote", "buy", "void", "track", "validate"]),
  packageId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const session = await requirePermission("orders:manage");
    const parsed = shippingActionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Shipping action details are invalid." },
        { status: 400 },
      );
    }
    const provider = getShippingProvider();
    if (!provider) {
      return NextResponse.json(
        { error: "Shippo is not configured. Add SHIPPO_API_TOKEN before using live shipping." },
        { status: 503 },
      );
    }
    const { action, packageId } = parsed.data;
    if (action === "quote") {
      return NextResponse.json(await quotePackage(db, provider, packageId));
    }
    if (action === "buy") {
      return NextResponse.json(
        await buyPackageLabel(db, provider, packageId, session.actor.id),
      );
    }
    if (action === "void") {
      return NextResponse.json(
        await voidPackageLabel(db, provider, packageId, session.actor.id),
      );
    }
    if (action === "track") {
      return NextResponse.json(await refreshPackageTracking(db, provider, packageId));
    }
    return NextResponse.json(
      await validatePackageAddress(db, provider, packageId, session.actor.id),
    );
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Shipping action failed." },
      { status: 409 },
    );
  }
}
