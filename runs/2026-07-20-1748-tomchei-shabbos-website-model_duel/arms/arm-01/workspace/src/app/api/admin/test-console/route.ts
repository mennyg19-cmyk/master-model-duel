import { z } from "zod";
import { NextResponse } from "next/server";
import {
  assertTestConsoleEnabled,
  seedScaleFixture,
  TestConsoleUnavailableError,
  wipeScaleFixture,
} from "@/domain/test-console";
import {
  adminRequestErrorResponse,
  requireSameOriginAdminRequest,
} from "@/lib/admin-request";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["seed", "reset", "wipe"]) }),
  z.object({ action: z.literal("setMode"), mode: z.enum(["TEST", "LIVE"]) }),
]);

export async function POST(request: Request) {
  try {
    requireSameOriginAdminRequest(request);
    assertTestConsoleEnabled();
    const session = await requirePermission("settings:manage");
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "A supported test-console action is required." }, { status: 400 });
    }
    let outcome: unknown;
    if (parsed.data.action === "setMode") {
      outcome = await db.appSetting.upsert({
        where: { key: "environment-mode" },
        update: { value: parsed.data.mode },
        create: { key: "environment-mode", value: parsed.data.mode },
      });
    } else if (parsed.data.action === "wipe") {
      outcome = await wipeScaleFixture(db);
    } else if (parsed.data.action === "seed") {
      outcome = await seedScaleFixture(db);
    } else if (parsed.data.action === "reset") {
      await wipeScaleFixture(db);
      outcome = await seedScaleFixture(db);
    }
    await db.auditLog.create({
      data: {
        actorStaffId: session.actor.id,
        action: `test_console.${parsed.data.action}`,
        targetType: "TestEnvironment",
        targetId: "local",
        metadata: parsed.data,
      },
    });
    return NextResponse.json({ outcome });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof TestConsoleUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return adminRequestErrorResponse(error);
  }
}
