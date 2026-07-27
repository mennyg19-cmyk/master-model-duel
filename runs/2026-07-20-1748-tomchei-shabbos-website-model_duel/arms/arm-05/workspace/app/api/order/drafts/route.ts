import { NextResponse } from "next/server";
import { createDraft } from "@/lib/order-builder";
import { maskError } from "@/lib/foundation";
import { hasSameOrigin } from "@/lib/route-auth";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const { draft, guestToken } = await createDraft(request);
    return NextResponse.json({
      draft: {
        id: draft.id,
        draftReference: draft.draftReference,
        subtotalCents: draft.subtotalCents,
        totalCents: draft.totalCents,
        wireFormat: draft.wireFormat,
        addresses: [],
        lines: [],
      },
      guestToken,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: maskError(error) }, { status: 400 });
  }
}
