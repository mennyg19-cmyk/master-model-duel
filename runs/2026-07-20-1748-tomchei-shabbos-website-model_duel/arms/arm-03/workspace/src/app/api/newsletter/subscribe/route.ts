import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { subscribe } from "@/lib/storefront/newsletter";

const bodySchema = z.object({
  email: z.string().email(),
  preferences: z
    .object({
      seasons: z.boolean().optional(),
      updates: z.boolean().optional(),
      promotions: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  let result;
  try {
    result = await subscribe(parsed.data.email, parsed.data.preferences);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Newsletter unavailable.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.publicMessage }, { status: 400 });
  }
  await writeAudit({
    action: "NEWSLETTER_SUBSCRIBED",
    meta: { email: result.value.email, id: result.value.id },
  });
  // Do not return unsubscribeToken — requires email verification path (H3).
  return NextResponse.json({
    ok: true,
    email: result.value.email,
  });
}
