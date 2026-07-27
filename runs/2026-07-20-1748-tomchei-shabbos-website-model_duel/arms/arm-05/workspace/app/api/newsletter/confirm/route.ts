import { NextResponse } from "next/server";
import { confirmSubscription, createUnsubscribeToken } from "@/lib/newsletter";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const subscriber = token ? await confirmSubscription(token) : null;
  if (!subscriber) {
    return NextResponse.json({ error: "This confirmation link is invalid or expired." }, { status: 400 });
  }
  const unsubscribeUrl = new URL("/unsubscribe", request.url);
  unsubscribeUrl.searchParams.set("token", createUnsubscribeToken(subscriber.id));
  return NextResponse.redirect(unsubscribeUrl);
}
