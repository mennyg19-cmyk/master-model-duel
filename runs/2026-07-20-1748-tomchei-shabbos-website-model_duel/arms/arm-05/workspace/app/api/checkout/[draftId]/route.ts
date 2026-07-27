import { NextResponse } from "next/server";
import { startCheckout } from "@/lib/checkout";
import { readDraft } from "@/lib/order-builder";
import { hasSameOrigin } from "@/lib/route-auth";

type RouteContext = { params: Promise<{ draftId: string }> };
const attempts = new Map<string, { count: number; resetAt: number }>();

function allowPublicAttempt(request: Request) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const current = attempts.get(key);
  const now = Date.now();
  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 12;
}

export async function POST(request: Request, context: RouteContext) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (!allowPublicAttempt(request)) return NextResponse.json({ error: "Too many checkout attempts. Wait one minute and try again." }, { status: 429 });
  const { draftId } = await context.params;
  const draft = await readDraft(request, draftId);
  if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  try {
    const checkout = await startCheckout(draft.id, await request.json().catch(() => null), request.url);
    return NextResponse.json(checkout);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Checkout could not start." }, { status: 400 });
  }
}
