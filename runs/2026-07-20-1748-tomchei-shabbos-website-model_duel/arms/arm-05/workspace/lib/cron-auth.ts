import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export function authorizeCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const expected = secret ? Buffer.from(secret) : null;
  const received = bearer ? Buffer.from(bearer) : null;
  const matches = Boolean(expected && received && expected.length === received.length && timingSafeEqual(expected, received));
  if (!matches) {
    return NextResponse.json({ error: "Cron bearer authentication failed." }, { status: 401 });
  }
  return null;
}
