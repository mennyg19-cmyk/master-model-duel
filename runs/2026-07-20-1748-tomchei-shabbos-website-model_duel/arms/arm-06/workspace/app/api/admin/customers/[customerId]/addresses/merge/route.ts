import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { mergeAddresses } from "@/lib/imports/legacy/cleanup";

const mergeSchema = z.object({
  keepId: z.string().min(1),
  dropIds: z.array(z.string().min(1)).min(1).max(20),
});

// UR-014: address-book cleanup merge. Keeps one row of a duplicate group and
// drops the rest inside one audited transaction; draft recipients hold an
// address snapshot so their SetNull link loses nothing.
export async function POST(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;
  const { customerId } = await params;

  const parsed = await parseBody(request, mergeSchema, "Merge request is invalid");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await mergeAddresses({
      customerId,
      keepId: parsed.data.keepId,
      dropIds: parsed.data.dropIds,
      ctx: gate.ctx,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
