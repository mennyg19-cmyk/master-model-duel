import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { createDriverLink } from "@/lib/routes/links";

export const dynamic = "force-dynamic";

const linkSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits").nullish(),
});

// UR-004/G-025: create (or rotate) the driver magic link. The raw URL is in
// THIS response only — it is never stored, so a refresh cannot recover it;
// rotating immediately kills the previous token.
export async function POST(request: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { routeId } = await params;
  const parsed = await parseBody(request, linkSchema, "An optional 4-digit PIN is the only field");
  if (!parsed.ok) return parsed.response;

  try {
    const link = await createDriverLink({ routeId, pin: parsed.data.pin ?? null, ctx: gate.ctx });
    return NextResponse.json({ ok: true, ...link });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
