import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { regroupPackage } from "@/lib/packages/moves";
import { PackageConcurrencyError } from "@/lib/packages/stages";

export const dynamic = "force-dynamic";

const regroupSchema = z.object({
  targetPackageId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  moves: z.array(z.object({ orderLineId: z.string().min(1), qty: z.number().int().positive() })).min(1).max(200),
});

// UR-001/G-003: staff regroup — lines move into another package of the same
// order. An emptied source is absorbed (row removed); the target's event
// trail plus this audit row retain what happened.
export async function POST(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;

  const parsed = await parseBody(request, regroupSchema, "A target package, the current version, and at least one line move are required");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await regroupPackage({
      packageId,
      targetPackageId: parsed.data.targetPackageId,
      expectedVersion: parsed.data.expectedVersion,
      moves: parsed.data.moves,
      actorId: gate.ctx.staff.id,
    });
    await recordAudit({
      ctx: gate.ctx,
      action: "package_regroup",
      targetType: "Package",
      targetId: packageId,
      metadata: { targetPackageId: parsed.data.targetPackageId, moves: parsed.data.moves, absorbed: result.absorbed },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error, [[PackageConcurrencyError, 409]]);
    if (mapped) return mapped;
    throw error;
  }
}
