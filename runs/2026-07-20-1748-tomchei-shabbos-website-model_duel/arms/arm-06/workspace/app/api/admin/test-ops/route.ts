import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { requireTestEnv } from "@/lib/testops/guard";
import { runTestOps } from "@/lib/testops/actions";

const actionSchema = z.object({
  action: z.enum(["seed", "clear", "wipe", "reset"]),
});

// R-101/R-129: the test console's one endpoint. Manager-tier permission PLUS
// the deployment class (APP_ENV=test) — neither alone is enough.
export async function POST(request: Request) {
  const gate = await requireApiPermission("settings.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, actionSchema, "Test-ops request is invalid");
  if (!parsed.ok) return parsed.response;

  try {
    requireTestEnv();
    const result = await runTestOps(prisma, parsed.data.action);
    await recordAudit({
      ctx: gate.ctx,
      action: `testops_${parsed.data.action}`,
      targetType: "TestOps",
      metadata: { counts: result.counts ? { ...result.counts } : null },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
