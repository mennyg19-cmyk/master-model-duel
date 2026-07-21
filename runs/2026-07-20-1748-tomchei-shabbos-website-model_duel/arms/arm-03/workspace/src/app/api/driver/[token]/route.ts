import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import {
  loadMagicLinkSession,
  markStopDelivered,
  startRouteViaMagicLink,
  verifyMagicPin,
} from "@/lib/routes/service";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const link = await loadMagicLinkSession(token);
    return NextResponse.json({
      ok: true,
      linkId: link.id,
      pinRequired: link.pinRequired,
      route: {
        id: link.route.id,
        name: link.route.name,
        status: link.route.status,
        startedAt: link.route.startedAt,
        completedAt: link.route.completedAt,
      },
      stops: link.route.stops.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        status: s.status,
        recipientName: s.recipientName,
        addressLine1: s.addressLine1,
        addressLine2: s.addressLine2,
        city: s.city,
        state: s.state,
        postalCode: s.postalCode,
        mapsUrl: s.mapsUrl,
        deliveredAt: s.deliveredAt,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify-pin"), pin: z.string().min(1) }),
  z.object({ action: z.literal("start"), pin: z.string().optional() }),
  z.object({
    action: z.literal("deliver"),
    stopId: z.string().min(1),
    pin: z.string().optional(),
  }),
]);

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const body = bodySchema.parse(await request.json());

    if (body.action === "verify-pin") {
      const result = await verifyMagicPin({ rawToken: token, pin: body.pin });
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.throttled ? "throttled" : "invalid_pin", throttled: result.throttled },
          { status: 401 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "start") {
      const route = await startRouteViaMagicLink({
        rawToken: token,
        pin: body.pin,
      });
      return NextResponse.json({ ok: true, route });
    }

    const result = await markStopDelivered({
      rawToken: token,
      stopId: body.stopId,
      pin: body.pin,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
