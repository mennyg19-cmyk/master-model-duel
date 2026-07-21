import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import {
  getTestMode,
  isTestEnvAllowed,
  reseedTestSeason,
  scalePrintProbe,
  setTestMode,
  wipeTestFixtures,
} from "@/lib/ops/test-ops";
import { runDressRehearsal } from "@/lib/ops/test-console";
import { db } from "@/lib/db";

function testEnvForbidden() {
  return NextResponse.json(
    {
      ok: false,
      error: "Destructive test-ops require IS_TEST_ENV=true or AUTH_MODE=dev (not production).",
    },
    { status: 403 },
  );
}

export async function GET() {
  try {
    await requirePermission("settings.write");
    if (!isTestEnvAllowed()) return testEnvForbidden();
    const testMode = await getTestMode();
    const scaleOrders = await db.order.count({
      where: {
        OR: [
          { checkoutSnapshot: { path: ["scaleFixture"], equals: "p6" } },
          { checkoutSnapshot: { path: ["scaleFixture"], equals: "p12" } },
        ],
      },
    });
    const packageCount = await db.package.count();
    return NextResponse.json({
      ok: true,
      testMode,
      scaleOrders,
      packageCount,
      testEnv: true,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const postSchema = z.object({
  action: z.enum([
    "setTestMode",
    "wipe",
    "reseed",
    "dressRehearsal",
    "scalePrintProbe",
  ]),
  enabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("settings.write");
    if (!isTestEnvAllowed()) return testEnvForbidden();

    const body = postSchema.parse(await request.json());

    if (body.action === "setTestMode") {
      const result = await setTestMode({
        enabled: Boolean(body.enabled),
        staffId: staff.effectiveStaff.id,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, testMode: result.value });
    }

    const mode = await getTestMode();
    if (!mode.enabled) {
      return NextResponse.json(
        { ok: false, error: "Enable test mode before destructive test-ops." },
        { status: 403 },
      );
    }

    if (body.action === "wipe") {
      const wiped = await wipeTestFixtures({ staffId: staff.effectiveStaff.id });
      if (!wiped.ok) {
        return NextResponse.json({ ok: false, error: wiped.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...wiped.value });
    }

    if (body.action === "reseed") {
      const reseeded = await reseedTestSeason({ staffId: staff.effectiveStaff.id });
      if (!reseeded.ok) {
        return NextResponse.json({ ok: false, error: reseeded.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...reseeded.value });
    }

    if (body.action === "dressRehearsal") {
      const result = await runDressRehearsal({
        staffId: staff.effectiveStaff.id,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...result.value });
    }

    const probe = await scalePrintProbe({ staffId: staff.effectiveStaff.id });
    if (!probe.ok) {
      return NextResponse.json({ ok: false, error: probe.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...probe.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
