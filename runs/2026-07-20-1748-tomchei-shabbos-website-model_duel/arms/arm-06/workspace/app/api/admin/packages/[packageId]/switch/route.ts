import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { switchPackageMethod } from "@/lib/routes/switch";

export const dynamic = "force-dynamic";

const switchSchema = z.object({
  to: z.enum(["SHIPPED", "PER_PACKAGE_DELIVERY"]),
  deliveryDay: z.string().min(1).optional(),
  confirmVoid: z.boolean().optional(),
});

// UR-002/G-005: shipping <-> delivery, charge preserved, audited. A
// purchased-but-unshipped label demands confirmVoid: true and voids through
// the P8 path; the response carries the preserved charge for the ledger.
export async function POST(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { packageId } = await params;
  const parsed = await parseBody(request, switchSchema, "A target method (SHIPPED or PER_PACKAGE_DELIVERY) is required");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await switchPackageMethod({ packageId, ...parsed.data, ctx: gate.ctx });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
