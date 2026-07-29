import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { splitPackage } from "@/lib/packages/moves";
import { PackageConcurrencyError } from "@/lib/packages/stages";

export const dynamic = "force-dynamic";

const splitSchema = z.object({
  expectedVersion: z.number().int().positive(),
  moves: z.array(z.object({ orderLineId: z.string().min(1), qty: z.number().int().positive() })).min(1).max(200),
});

// G-003: staff split — chosen line qtys become a second physical package with
// the same grouping identity. Both sides keep the order link and get split
// events; the global audit row carries the full move list.
export async function POST(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;

  const parsed = await parseBody(request, splitSchema, "The current version and at least one line move are required");
  if (!parsed.ok) return parsed.response;

  try {
    const created = await splitPackage({
      packageId,
      expectedVersion: parsed.data.expectedVersion,
      moves: parsed.data.moves,
      actorId: gate.ctx.staff.id,
    });
    await recordAudit({
      ctx: gate.ctx,
      action: "package_split",
      targetType: "Package",
      targetId: packageId,
      metadata: { newPackageId: created.id, moves: parsed.data.moves },
    });
    return NextResponse.json({ ok: true, newPackageId: created.id });
  } catch (error) {
    const mapped = mapDomainError(error, [[PackageConcurrencyError, 409]]);
    if (mapped) return mapped;
    throw error;
  }
}
