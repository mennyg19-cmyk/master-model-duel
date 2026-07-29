import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { TRIGGERED_DEFAULTS, TRIGGERED_KEYS } from "@/lib/email/triggered";

export const dynamic = "force-dynamic";

// R-086: the triggered-key registry — every key with its coded default, its
// override row when one exists, and the templates an override can point at.
export async function GET() {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const [overrides, templates] = await Promise.all([
    prisma.emailTriggeredOverride.findMany(),
    prisma.emailTemplate.findMany({ orderBy: { key: "asc" }, select: { id: true, key: true, name: true } }),
  ]);
  const keys = TRIGGERED_KEYS.map((key) => ({
    key,
    name: TRIGGERED_DEFAULTS[key].name,
    defaultSubject: TRIGGERED_DEFAULTS[key].subject,
    defaultBodyText: TRIGGERED_DEFAULTS[key].bodyText,
    override: overrides.find((entry) => entry.key === key) ?? null,
  }));
  return NextResponse.json({ ok: true, keys, templates });
}
