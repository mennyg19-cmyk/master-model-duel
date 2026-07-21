import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { resolveReplacementChain } from "@/lib/catalog/replacements";

const schema = z.object({
  fromProductId: z.string().min(1),
  targetSeasonId: z.string().min(1),
});

/** Admin helper — resolve cross-season replacement chain (R-048, G-013). */
export async function POST(request: Request) {
  try {
    await requirePermission("settings.read");
    const body = schema.parse(await request.json());
    const resolved = await resolveReplacementChain(body.fromProductId, body.targetSeasonId);
    return NextResponse.json({ ok: true, resolved });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
