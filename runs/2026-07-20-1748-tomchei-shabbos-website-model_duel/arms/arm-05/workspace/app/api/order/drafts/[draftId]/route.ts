import { NextResponse } from "next/server";
import { draftSchema, readDraft, saveDraft, serializeDraft } from "@/lib/order-builder";
import { maskError } from "@/lib/foundation";
import { hasSameOrigin } from "@/lib/route-auth";

type RouteContext = { params: Promise<{ draftId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { draftId } = await context.params;
  const draft = await readDraft(request, draftId);
  if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  return NextResponse.json({ draft: serializeDraft(draft) });
}

export async function PUT(request: Request, context: RouteContext) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide at least one valid cart line and recipient." }, { status: 400 });
  try {
    const { draftId } = await context.params;
    const draft = await saveDraft(request, draftId, parsed.data);
    return NextResponse.json({ draft: serializeDraft(draft) });
  } catch (error) {
    const message = maskError(error);
    return NextResponse.json({ error: message }, { status: message.includes("not found") || message.includes("access") ? 404 : 400 });
  }
}
