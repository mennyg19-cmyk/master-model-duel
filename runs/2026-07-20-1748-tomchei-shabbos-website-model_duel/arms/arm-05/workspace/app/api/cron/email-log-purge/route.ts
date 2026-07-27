import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { purgeEmailLogs } from "@/lib/email";

export async function GET(request: Request) {
  const rejected = authorizeCron(request);
  if (rejected) return rejected;
  return NextResponse.json({ purged: await purgeEmailLogs() });
}

export const POST = GET;
