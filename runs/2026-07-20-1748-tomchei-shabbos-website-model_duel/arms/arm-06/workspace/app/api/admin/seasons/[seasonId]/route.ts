import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { setSeasonSchedule, setSeasonStatus } from "@/lib/seasons/manage";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    status: z.enum(["OPEN", "CLOSED"]).optional(),
    scheduledOpensAt: z.string().datetime({ offset: true }).nullable().optional(),
    scheduledClosesAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((value) => value.status || "scheduledOpensAt" in value || "scheduledClosesAt" in value, {
    message: "Nothing to update",
  });

// P10 (G-011/UR-008): the manager Open/Closed switch + optional scheduled
// auto-flip. datetimes arrive ISO-with-offset (the UI converts local input);
// null clears a schedule.
export async function PATCH(request: Request, { params }: { params: Promise<{ seasonId: string }> }) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;
  const { seasonId } = await params;

  const parsed = await parseBody(request, patchSchema, "A status or schedule is required");
  if (!parsed.ok) return parsed.response;

  try {
    let flippedFrom: string | undefined;
    if (parsed.data.status) {
      const result = await setSeasonStatus({ seasonId, status: parsed.data.status, ctx: gate.ctx });
      flippedFrom = result.flippedFrom;
    }
    if ("scheduledOpensAt" in parsed.data || "scheduledClosesAt" in parsed.data) {
      await setSeasonSchedule({
        seasonId,
        scheduledOpensAt:
          parsed.data.scheduledOpensAt === undefined
            ? undefined
            : parsed.data.scheduledOpensAt
              ? new Date(parsed.data.scheduledOpensAt)
              : null,
        scheduledClosesAt:
          parsed.data.scheduledClosesAt === undefined
            ? undefined
            : parsed.data.scheduledClosesAt
              ? new Date(parsed.data.scheduledClosesAt)
              : null,
        ctx: gate.ctx,
      });
    }
    return NextResponse.json({ ok: true, flippedFrom });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
