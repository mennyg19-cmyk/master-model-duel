import { z } from "zod";
import { ZodError } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { getSetting, setSetting, isSettingKey, SETTING_KEYS, type SettingKey } from "@/lib/settings";

export async function GET() {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const entries = await Promise.all(
    SETTING_KEYS.map(async (key) => [key, await getSetting(key)] as const)
  );
  return Response.json(Object.fromEntries(entries));
}

const patchSchema = z.object({ key: z.string(), value: z.unknown() });

export async function PATCH(request: Request) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isSettingKey(parsed.data.key)) {
    return Response.json({ error: "Unknown setting key." }, { status: 400 });
  }

  const key = parsed.data.key as SettingKey;
  try {
    const saved = await setSetting(key, parsed.data.value);
    await writeAudit(gate.staff, { action: "settings.update", targetType: "Setting", targetId: key, detail: { value: saved as never } });
    return Response.json({ ok: true, value: saved });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: error.issues[0].message }, { status: 400 });
    }
    throw error;
  }
}
