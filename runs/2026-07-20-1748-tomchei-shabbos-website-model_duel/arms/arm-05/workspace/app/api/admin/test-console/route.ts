import { NextResponse } from "next/server";
import { z } from "zod";
import { seed } from "../../../../prisma/seed";
import { prisma } from "@/lib/db";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const actionSchema = z.object({ action: z.enum(["seed", "wipe", "reset"]) });

function isTestConsoleEnabled() {
  return process.env.TEST_MODE === "true" && ["development", "test"].includes(process.env.NODE_ENV ?? "");
}

async function wipeTestData(actorId: string, action: "wipe" | "reset") {
  await prisma.$transaction(async (transaction) => {
    const tables = await transaction.$queryRawUnsafe<Array<{ tablename: string }>>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'StaffUser', 'AppSetting', 'AuditEvent')",
    );
    const names = tables.map(({ tablename }) => `"${tablename.replaceAll("\"", "\"\"")}"`).join(", ");
    if (names) await transaction.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
    await transaction.auditEvent.create({
      data: { actorId, action: `test_console.${action}`, details: { environment: process.env.NODE_ENV } },
    });
  });
}

export async function GET(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!isTestConsoleEnabled()) return NextResponse.json({ error: "The test console is disabled outside an explicit test environment." }, { status: 404 });
  return NextResponse.json({ testMode: true, environment: process.env.NODE_ENV, actions: ["seed", "wipe", "reset"] });
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!isTestConsoleEnabled()) return NextResponse.json({ error: "The test console is disabled outside an explicit test environment." }, { status: 404 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose seed, wipe, or reset." }, { status: 400 });
  if (parsed.data.action === "wipe" || parsed.data.action === "reset") {
    await wipeTestData(authorization.staffMember.id, parsed.data.action);
  }
  if (parsed.data.action === "seed" || parsed.data.action === "reset") await seed();
  if (parsed.data.action === "seed") {
    await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "test_console.seed", details: { environment: process.env.NODE_ENV } } });
  }
  return NextResponse.json({ completed: parsed.data.action });
}
