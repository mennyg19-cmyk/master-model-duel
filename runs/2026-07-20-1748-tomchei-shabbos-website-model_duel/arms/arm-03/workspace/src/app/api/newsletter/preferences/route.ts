import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { updatePreferencesWithToken } from "@/lib/storefront/newsletter";

const bodySchema = z.object({
  token: z.string().min(1),
  preferences: z.object({
    seasons: z.boolean(),
    updates: z.boolean(),
  }),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preferences payload." }, { status: 400 });
  }
  let result;
  try {
    result = await updatePreferencesWithToken(parsed.data.token, parsed.data.preferences);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Newsletter unavailable.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.publicMessage }, { status: 401 });
  }
  await writeAudit({
    action: "NEWSLETTER_SUBSCRIBED",
    meta: { email: result.value.email, id: result.value.id, prefsUpdated: true },
  });
  return NextResponse.json({ ok: true, id: result.value.id });
}
