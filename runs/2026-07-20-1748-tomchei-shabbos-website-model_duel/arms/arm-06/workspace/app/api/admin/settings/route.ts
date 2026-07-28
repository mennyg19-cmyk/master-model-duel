import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { setSetting, SettingKey, SettingValue } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Keys the settings hub may write, whitelisted so this route can never become
// a generic settings backdoor.
const WRITABLE_KEYS = ["shipping.deliveryZips", "shipping.rates", "shipping.rules"] as const;
type WritableKey = (typeof WRITABLE_KEYS)[number];

const postSchema = z.object({
  key: z.enum(WRITABLE_KEYS),
  value: z.unknown(),
});

// R-094/095: settings writes go through the typed store, so each key's own
// zod schema is the final validation gate (bad shapes are 400s below).
export async function POST(request: Request) {
  const gate = await requireApiPermission("settings.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, postSchema, "A settings key and value are required");
  if (!parsed.ok) return parsed.response;

  try {
    await setSetting(
      parsed.data.key as SettingKey,
      parsed.data.value as SettingValue<WritableKey & SettingKey>,
    );
  } catch (error) {
    // The client gets the generic shape message; the real cause (schema bug
    // vs. bad input vs. DB failure) stays distinguishable in the server log.
    console.error(`settings write failed for ${parsed.data.key}`, error);
    return NextResponse.json(
      { error: "That value doesn't match the shape this setting expects" },
      { status: 400 },
    );
  }

  await recordAudit({
    ctx: gate.ctx,
    action: "settings_update",
    targetType: "Setting",
    targetId: parsed.data.key,
  });

  return NextResponse.json({ ok: true });
}
