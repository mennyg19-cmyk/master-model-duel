import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";

const schema = z.object({
  userId: z.string().min(1),
});

export async function POST(request: Request) {
  const env = getEnv();
  if (env.AUTH_MODE !== "dev") {
    return NextResponse.json({ ok: false, error: "Dev auth only" }, { status: 404 });
  }
  const body = schema.parse(await request.json());
  const jar = await cookies();
  jar.set("dev_user_id", body.userId, { path: "/", httpOnly: false });
  return NextResponse.json({ ok: true, userId: body.userId });
}
