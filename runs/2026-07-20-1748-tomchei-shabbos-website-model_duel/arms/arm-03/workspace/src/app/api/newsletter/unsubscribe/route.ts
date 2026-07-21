import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { unsubscribeWithToken, verifyUnsubscribeToken } from "@/lib/storefront/newsletter";

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  // Expose verify failures distinctly for smoke (tampered / expired).
  const pre = verifyUnsubscribeToken(parsed.data.token);
  if (!pre.ok) {
    return NextResponse.json({ error: pre.publicMessage, reason: pre.error }, { status: 400 });
  }

  const result = await unsubscribeWithToken(parsed.data.token);
  if (!result.ok) {
    return NextResponse.json({ error: result.publicMessage, reason: result.error }, { status: 400 });
  }
  await writeAudit({
    action: "NEWSLETTER_UNSUBSCRIBED",
    meta: { email: result.value.email },
  });
  return NextResponse.json({ ok: true, email: result.value.email });
}
