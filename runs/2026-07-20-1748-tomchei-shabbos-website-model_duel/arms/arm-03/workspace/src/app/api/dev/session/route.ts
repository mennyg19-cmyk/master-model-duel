import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";

const schema = z.object({
  userId: z.string().min(1),
});

function allowlist(): Set<string> {
  const env = getEnv();
  return new Set(
    [
      env.DEV_MANAGER_USER_ID,
      env.DEV_STAFF_USER_ID,
      env.DEV_DRIVER_USER_ID,
      env.DEV_CUSTOMER_USER_ID,
      env.DEV_ACTING_USER_ID,
    ].filter((id): id is string => Boolean(id)),
  );
}

export async function POST(request: Request) {
  const env = getEnv();
  if (env.AUTH_MODE !== "dev" || env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Dev auth only" }, { status: 404 });
  }
  const body = schema.parse(await request.json());
  if (!allowlist().has(body.userId)) {
    return NextResponse.json(
      { ok: false, error: "User id not in DEV_* allowlist" },
      { status: 403 },
    );
  }
  const jar = await cookies();
  jar.set("dev_user_id", body.userId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
  });
  return NextResponse.json({ ok: true, userId: body.userId });
}
