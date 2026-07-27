import { NextResponse } from "next/server";
import { z } from "zod";
import { reassignRoute, routePdf } from "@/lib/delivery";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

type RouteContext = { params: Promise<{ routeId: string }> };

const actionSchema = z.object({ action: z.literal("reassign"), driverId: z.string().cuid().nullable() });

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorize(request, "orders.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { routeId } = await context.params;
  const greetingCards = new URL(request.url).searchParams.get("print") === "greeting_cards";
  try {
    return new NextResponse(await routePdf(routeId, greetingCards), {
      headers: {
        "content-disposition": `inline; filename="${greetingCards ? "greeting-cards" : "driver-route"}-${routeId}.pdf"`,
        "content-type": "application/pdf",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Route print could not be prepared." }, { status: 404 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const authorization = await authorize(request, "orders.write");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid route reassignment." }, { status: 400 });
  const { routeId } = await context.params;
  try {
    return NextResponse.json({ route: await reassignRoute(routeId, parsed.data.driverId, authorization.staffMember.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Route could not be reassigned." }, { status: 400 });
  }
}
