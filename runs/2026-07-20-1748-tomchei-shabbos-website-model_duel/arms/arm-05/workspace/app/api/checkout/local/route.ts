import { NextResponse } from "next/server";
import { completeCheckout } from "@/lib/checkout";
import { hasSameOrigin } from "@/lib/route-auth";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "Local payment harness is disabled." }, { status: 404 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => null) as { sessionId?: string } | null;
  if (!body?.sessionId?.startsWith("cs_local_")) return NextResponse.json({ error: "Invalid local checkout session." }, { status: 400 });
  try {
    return NextResponse.json(await completeCheckout(body.sessionId, `evt_local_${body.sessionId}`));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Local payment could not complete." }, { status: 400 });
  }
}
