import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { sweepEmailOutbox } from "@/lib/email";

export async function GET(request: Request) {
  const rejected = authorizeCron(request);
  if (rejected) return rejected;
  return NextResponse.json(await sweepEmailOutbox());
}

export const POST = GET;
