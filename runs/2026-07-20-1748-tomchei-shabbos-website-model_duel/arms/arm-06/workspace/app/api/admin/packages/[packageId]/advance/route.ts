import { NextResponse } from "next/server";
import { z } from "zod";
import { PackageStage } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { advancePackageStage, PackageConcurrencyError } from "@/lib/packages/stages";

export const dynamic = "force-dynamic";

const advanceSchema = z.object({
  to: z.enum(PackageStage),
  expectedVersion: z.number().int().positive(),
});

// UR-001/G-004: per-package stage advance from the board. The method's stage
// list is the only law (PRINTED never implied, terminal stages end the line);
// the version guard makes a stale board tab a conflict, not an overwrite.
export async function POST(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;

  const parsed = await parseBody(request, advanceSchema, "A target stage and the current version are required");
  if (!parsed.ok) return parsed.response;

  try {
    const pkg = await advancePackageStage({
      packageId,
      expectedVersion: parsed.data.expectedVersion,
      to: parsed.data.to,
      actorId: gate.ctx.staff.id,
    });
    return NextResponse.json({ ok: true, package: { id: pkg.id, stage: pkg.stage, version: pkg.version } });
  } catch (error) {
    const mapped = mapDomainError(error, [[PackageConcurrencyError, 409]]);
    if (mapped) return mapped;
    throw error;
  }
}
