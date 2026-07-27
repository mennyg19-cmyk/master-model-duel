import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { sendPaymentReminders } from "@/lib/delivery";

export async function GET(request: Request) {
  const rejected = authorizeCron(request);
  if (rejected) return rejected;
  return NextResponse.json({ reminders: await sendPaymentReminders() });
}

export const POST = GET;
