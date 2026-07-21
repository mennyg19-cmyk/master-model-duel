import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { confirmRepeatOrder, previewRepeatOrder, repeatOrder } from "@/lib/ops/repeat";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    mode: z.enum(["auto", "preview", "confirm"]).default("auto"),
    targetSeasonId: z.string().optional(),
    choices: z
      .array(
        z.object({
          sourceLineId: z.string().min(1),
          action: z.enum(["map", "remove"]),
          toProductId: z.string().nullable().optional(),
          keepRecipient: z.boolean().optional(),
          savedAddressId: z.string().nullable().optional(),
        }),
      )
      .optional(),
  })
  .optional();

export async function POST(request: Request, ctx: Ctx) {
  try {
    const staff = await requirePermission("admin.access");
    const { id } = await ctx.params;
    const raw = await request.text();
    const body = raw.trim() ? bodySchema.parse(JSON.parse(raw)) : { mode: "auto" as const };

    if (body?.mode === "preview") {
      const preview = await previewRepeatOrder({
        sourceOrderId: id,
        targetSeasonId: body.targetSeasonId,
      });
      if (!preview.ok) {
        return NextResponse.json({ ok: false, error: preview.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, preview: preview.value });
    }

    if (body?.mode === "confirm") {
      if (!body.choices?.length) {
        return NextResponse.json({ ok: false, error: "choices required" }, { status: 400 });
      }
      const result = await confirmRepeatOrder({
        sourceOrderId: id,
        targetSeasonId: body.targetSeasonId,
        choices: body.choices,
        actorStaffId: staff.effectiveStaff.id,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...result.value });
    }

    const result = await repeatOrder({
      sourceOrderId: id,
      staffId: staff.effectiveStaff.id,
      targetSeasonId: body?.targetSeasonId,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
