import { NextResponse } from "next/server";
import {
  confirmSubscription,
  createNewsletterPreferencesToken,
  createUnsubscribeToken,
} from "@/lib/newsletter";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const subscriber = token ? await confirmSubscription(token) : null;
  if (!subscriber) {
    return NextResponse.json({ error: "This confirmation link is invalid or expired." }, { status: 400 });
  }
  const response = NextResponse.redirect(new URL("/unsubscribe", request.url));
  const cookieOptions = {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
    path: "/api/newsletter",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  response.cookies.set("newsletter-preferences-token", createNewsletterPreferencesToken(subscriber.id), cookieOptions);
  response.cookies.set("newsletter-unsubscribe-token", createUnsubscribeToken(subscriber.id), cookieOptions);
  return response;
}
